/* ============================================================
   city/speedway_structures.js — THE BUILDINGS OF DIAMOND SPEEDWAY.

   WHY THIS FILE EXISTS: island_speedway.js owns the LAND — the racing
   line, the banked ribbon, the walls, the paint. Everything a circuit
   needs ON TOP of that land (grandstands, pit garages, the scoring
   pylon, the jumbotron, floodlight masts, hoardings, marshal posts,
   tyre walls, the paddock) is architecture, and architecture is its
   own problem. Keeping it here means the track geometry file stays
   readable and every structure is authored against ONE published
   contract: the track frame.

   THE CONTRACT (the `S` context island_speedway.js hands in):
     S.root            THREE.Group everything is added to (city.root)
     S.frame(t)        the ONE racing-line frame (see island_speedway.js)
     S.heightAt(t,u)   banked surface height at param t, across-track u
     S.bankAt(t)       bank angle (rad) at t
     S.strip(prof,o)   sweep a ribbon along the frame (the workhorse)
     S.solid(...)      push an AABB collider
     S.L               centreline length (m)
     S.HALFW/APRON_W/SHOULDER_W/SKIRT_W/WALL_H   cross-section metrics
     S.rng()           deterministic stream (CBZ.seedStream("speedway"))
     S.C               shared colour palette
     S.label(txt,o)    CBZ.makeLabelSprite wrapper (may return null)

   ACROSS-TRACK CONVENTION: `u` is metres from the racing-line centre
   along the OUTWARD normal. u<0 = infield/apron/pit side, u>0 = wall
   side. Every structure is placed in (t,u) so it FOLLOWS the curve —
   a grandstand on a tri-oval is a curved building, not a shoebox.

   PERF: repeated elements (seats, fence posts, truss members, tyres,
   lamps) are InstancedMesh; ribbons (roofs, fascias, hoardings, walls)
   are ONE swept BufferGeometry each. Seat colour patterning uses
   InstancedMesh.setColorAt (r128 supports instanceColor), so 3,500
   seats spelling a word across the bowl still cost one draw call.

   DETERMINISM: no Math.random anywhere — S.rng() / CBZ.hash01 only.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };

  const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(),
    _V = new THREE.Vector3(), _V2 = new THREE.Vector3(), _SC = new THREE.Vector3(1, 1, 1),
    _ZAX = new THREE.Vector3(0, 0, 1), _YAX = new THREE.Vector3(0, 1, 0);

  // ------------------------------------------------------------------ //
  //  small shared helpers                                               //
  // ------------------------------------------------------------------ //
  function css(c) { return "#" + (c >>> 0).toString(16).padStart(6, "0"); }
  function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function maxAniso() {
    try { return Math.min(8, CBZ.renderer.capabilities.getMaxAnisotropy()); } catch (e) { return 1; }
  }
  function texFrom(cv, repX, repY) {
    const t = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;
    t.wrapS = repX ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.wrapT = repY ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = maxAniso();
    return t;
  }
  function boxGeo(w, h, d) {
    return CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d);
  }
  function box(parent, m, x, y, z, w, h, d, yaw, roll) {
    const mesh = new THREE.Mesh(boxGeo(w, h, d), m);
    mesh.position.set(x, y, z);
    if (yaw) mesh.rotation.y = yaw;
    if (roll) mesh.rotation.z = roll;
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  // a unit cube stretched between two world points — the primitive every
  // lattice (truss, mast, gantry, railing) in this file is made of.
  const UNIT = new THREE.BoxGeometry(1, 1, 1);
  UNIT._shared = true;
  function strutMatrix(x1, y1, z1, x2, y2, z2, thick, out) {
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    const len = Math.hypot(dx, dy, dz) || 0.001;
    _V.set(dx / len, dy / len, dz / len);
    _Q.setFromUnitVectors(_ZAX, _V);
    _SC.set(thick, thick, len);
    _V2.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    return (out || _M).compose(_V2, _Q, _SC);
  }
  // an InstancedMesh of struts you fill with pushStrut(); call finishIM at the end.
  function makeIM(m, n, opts) {
    const im = new THREE.InstancedMesh(UNIT, m, n);
    im.castShadow = !(opts && opts.noShadow);
    im.receiveShadow = !(opts && opts.noShadow);
    im.count = 0;
    return im;
  }
  function pushStrut(im, x1, y1, z1, x2, y2, z2, thick) {
    if (im.count >= im.instanceMatrix.count) return;
    im.setMatrixAt(im.count++, strutMatrix(x1, y1, z1, x2, y2, z2, thick));
  }
  function finishIM(parent, im) {
    if (!im.count) return null;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    parent.add(im);
    return im;
  }

  // ------------------------------------------------------------------ //
  //  THE PROP LEDGER — "every prop is interactable or gone."            //
  //                                                                     //
  //  OWNER: "TONS OF DUMB PROPS, I HATE DUMB PROPS." A prop earns its   //
  //  place by reading intentional AND standing on something, or it is   //
  //  cut. `propKeep(n, bottomY, supportY)` is where a builder DECLARES  //
  //  what the thing it just drew is standing on — and it is not a       //
  //  formality: `floating` counts the ones whose own arithmetic says    //
  //  they are in the air, so a re-seat that misses by a decimal shows   //
  //  up as a number rather than as a screenshot months later.           //
  //  `propCut(n)` records what this build REFUSED to draw, so the purge //
  //  is measurable instead of being a claim in a commit message.        //
  // ------------------------------------------------------------------ //
  const PROPS = { kept: 0, cut: 0, floating: 0 };
  function propKeep(n, bottomY, supportY) {
    PROPS.kept += (n == null ? 1 : n);
    if (bottomY != null && supportY != null && bottomY - supportY > 0.06) PROPS.floating++;
  }
  function propCut(n) { PROPS.cut += (n == null ? 1 : n); }

  // THE ONE TYRE. The trackside tyre walls and the garage bays' spare sets are
  // both stacks of this, so a circuit tyre is one geometry and one decision.
  let _tyreGeo = null;
  function tyreGeom() {
    if (!_tyreGeo) {
      _tyreGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.34, 10);
      _tyreGeo._shared = true;
    }
    return _tyreGeo;
  }

  // ------------------------------------------------------------------ //
  //  PROCEDURAL TEXTURES (deterministic — fixed arithmetic sequences,   //
  //  never Math.random; see world/materials.js concreteTex for the      //
  //  house pattern this copies)                                         //
  // ------------------------------------------------------------------ //
  const SPONSORS = [
    "DIAMOND", "APEX FUEL", "VOLTA", "REDLINE", "NITRO CO", "BAYSIDE",
    "IRONCLAD", "SUNSTRIP", "OCTANE", "MERIDIAN", "GRIT TYRES", "HALCYON",
    "CBZ MOTORS", "SALTLAND", "NORTHBAY", "TORQUE", "K-LINE", "VERTEX",
  ];
  const PANEL_BG = [0xc23a36, 0x1b6ec8, 0x2ba24a, 0xe0a92e, 0x24303c, 0xd66a2e,
    0x6a2bd6, 0x0f9aa8, 0xb2b7bd, 0x8f1f3d];

  // a repeating trackside advertising band. `salt` shifts which sponsors
  // land where, so the pit wall, the SAFER wall and the roof fascia never
  // read as the same decal repeated.
  const _bandCache = {};
  function sponsorBand(salt, h) {
    const key = salt + "|" + (h || 96);
    if (_bandCache[key]) return _bandCache[key];
    const W = 1024, H = h || 96;
    const cv = canvas(W, H), g = cv.getContext("2d");
    const PANELS = 6, pw = W / PANELS;
    for (let i = 0; i < PANELS; i++) {
      const idx = (i * 5 + salt * 3) % SPONSORS.length;
      const bg = PANEL_BG[(i * 3 + salt) % PANEL_BG.length];
      g.fillStyle = css(bg);
      g.fillRect(i * pw, 0, pw, H);
      // a thin darker plinth + top rail so panels read as bolted-on boards
      g.fillStyle = "rgba(0,0,0,.28)";
      g.fillRect(i * pw, H - H * 0.12, pw, H * 0.12);
      g.fillRect(i * pw, 0, pw, H * 0.06);
      g.fillStyle = "rgba(255,255,255,.10)";
      g.fillRect(i * pw + 2, H * 0.06, pw - 4, 2);
      // sponsor word
      const word = SPONSORS[idx];
      g.fillStyle = "#f3f6fa";
      g.font = "700 " + Math.round(H * 0.42) + "px Fredoka, system-ui, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(word, i * pw + pw / 2, H * 0.46, pw * 0.88);
      // separator between boards
      g.fillStyle = "rgba(0,0,0,.45)";
      g.fillRect(i * pw + pw - 2, 0, 3, H);
    }
    const t = texFrom(cv, true, false);
    _bandCache[key] = t;
    return t;
  }

  // chain-link catch fencing — alpha-tested, so no transparency sorting
  let _chainTex = null;
  function chainLink() {
    if (_chainTex) return _chainTex;
    const N = 128, cv = canvas(N, N), g = cv.getContext("2d");
    g.clearRect(0, 0, N, N);
    g.strokeStyle = "rgba(196,204,212,0.95)";
    g.lineWidth = 3.0;
    for (let i = -N; i < N * 2; i += 16) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + N, N); g.stroke();
      g.beginPath(); g.moveTo(i + N, 0); g.lineTo(i, N); g.stroke();
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = maxAniso();
    _chainTex = t;
    return t;
  }

  // gravel trap / run-off aggregate
  let _gravelTex = null;
  function gravelTex() {
    if (_gravelTex) return _gravelTex;
    const N = 256, cv = canvas(N, N), g = cv.getContext("2d");
    g.fillStyle = "#9c968a"; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 2600; i++) {
      const x = (i * 53) % N, y = (i * 97) % N, r = 0.7 + ((i * 29) % 7) * 0.22;
      const v = 120 + ((i * 37) % 70);
      g.fillStyle = "rgba(" + v + "," + (v - 6) + "," + (v - 18) + ",0.75)";
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    _gravelTex = texFrom(cv, true, true);
    _gravelTex.repeat.set(6, 6);
    return _gravelTex;
  }

  // the jumbotron / pylon panel face. `t.redraw(lines)` repaints it in place
  // (used by island_speedway.js's low-rate board updater during a race).
  function paintScreen(cv, lines) {
    const g = cv.getContext("2d"), W = cv.width, H = cv.height;
    g.fillStyle = "#070b10"; g.fillRect(0, 0, W, H);
    // scanline grid so the panel reads as an LED wall, not a painted board
    g.fillStyle = "rgba(255,255,255,.035)";
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    g.textAlign = "left"; g.textBaseline = "middle";
    const n = Math.max(1, lines.length);
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const y = H * (i + 0.62) / n;
      g.fillStyle = ln.color || "#ffd451";
      g.font = "700 " + Math.round(H / n * 0.56) + "px Fredoka, system-ui, sans-serif";
      g.fillText(ln.text, W * 0.05, y, W * 0.9);
      if (ln.right) {
        g.textAlign = "right";
        g.fillStyle = ln.rightColor || "#9fe6c8";
        g.fillText(ln.right, W * 0.95, y, W * 0.35);
        g.textAlign = "left";
      }
    }
  }
  function screenTex(lines, w, h) {
    const cv = canvas(w || 512, h || 256);
    paintScreen(cv, lines);
    const t = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t._cv = cv;
    t.redraw = function (ls) { paintScreen(cv, ls || []); t.needsUpdate = true; };
    return t;
  }

  // ------------------------------------------------------------------ //
  //  SEAT-COLOUR PATTERNING — a 5x7 bitmap font. Real stadia spell the  //
  //  venue name in contrasting seats; ours does too, and it costs zero  //
  //  extra draw calls (InstancedMesh.setColorAt).                       //
  // ------------------------------------------------------------------ //
  const FONT = {
    A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    E: ["11111", "10000", "11110", "10000", "10000", "10000", "11111"],
    I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    M: ["10001", "11011", "10101", "10001", "10001", "10001", "10001"],
    N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    W: ["10001", "10001", "10001", "10101", "10101", "11011", "01010"],
    Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  };
  // returns a fn(col,row)->bool marking seats that belong to the word.
  // rows count UP from the bottom of the bowl; the word is centred.
  function wordMask(word, cols, rows, px, py, rowBase) {
    const chars = String(word).toUpperCase().split("");
    const glyphW = 5 * px + px, gw = glyphW;             // 1px letter spacing
    const totalW = chars.length * gw - px;
    const c0 = Math.round((cols - totalW) / 2);
    const r0 = rowBase;
    return function (c, r) {
      const lc = c - c0, lr = r - r0;
      if (lc < 0 || lr < 0) return false;
      if (lr >= 7 * py) return false;
      const ci = Math.floor(lc / gw);
      if (ci < 0 || ci >= chars.length) return false;
      const gx = Math.floor((lc - ci * gw) / px);
      if (gx >= 5) return false;
      const gy = 6 - Math.floor(lr / py);                 // font rows are top-down
      const rowsArr = FONT[chars[ci]] || FONT[" "];
      return rowsArr[gy].charAt(gx) === "1";
    };
  }

  // ================================================================== //
  //  GRANDSTAND — a raked, CURVED seating bowl that follows the track. //
  //  Real anatomy: plinth, stepped concrete rake, aisles with stair    //
  //  treads, vomitory portals, seats on every tread, a back concourse  //
  //  facade with stair towers, and a cantilevered roof on a real       //
  //  truss with a sponsor fascia.                                      //
  // ================================================================== //
  function grandstand(S, P) {
    const C = S.C;
    const t0 = P.t0, t1 = P.t1;
    const ROWS = P.rows || 26;
    const TREAD = 0.95, RISE = 0.52, SEAT_W = 0.92;
    const uBase = P.uBase == null ? 30 : P.uBase;
    const plinth = P.plinth == null ? 1.7 : P.plinth;
    const arc = Math.abs(t1 - t0) * S.L;
    const COLS = Math.max(24, Math.round(arc / SEAT_W));
    const AISLE_EVERY = 22;                              // seats between aisles
    const uBack = uBase + ROWS * TREAD;
    const topY = plinth + ROWS * RISE;
    const audience = [];
    const cap = P.audienceCap == null ? 40 : P.audienceCap;

    const grp = new THREE.Group();
    grp.name = P.name || "speedway-grandstand";
    S.root.add(grp);

    // ---- 1. the raked concrete bowl (ONE swept staircase ribbon) ----
    const prof = [];
    for (let r = 0; r <= ROWS; r++) {
      prof.push({ u: uBase + r * TREAD, dy: plinth + r * RISE, abs: true, uv: r / ROWS });
      if (r < ROWS) prof.push({ u: uBase + (r + 1) * TREAD, dy: plinth + r * RISE, abs: true, uv: (r + 0.5) / ROWS });
    }
    S.strip(prof, {
      t0: t0, t1: t1, closed: false, step: 3.0, parent: grp,
      mat: cmat(C.STAND), vLen: 6, name: "grandstand-rake",
    });
    // plinth face (the wall the front row sits on, seen from the track)
    S.strip([{ u: uBase, dy: 0.02, abs: true }, { u: uBase, dy: plinth, abs: true }], {
      t0: t0, t1: t1, closed: false, step: 3.0, parent: grp,
      mat: cmat(C.CONCRETE), vLen: 6, name: "grandstand-plinth",
    });

    // ---- 2. seats (one InstancedMesh, per-instance colour patterning) ----
    const seatGeo = new THREE.BoxGeometry(SEAT_W * 0.82, 0.42, 0.46);
    const seatMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const seatIM = new THREE.InstancedMesh(seatGeo, seatMat, ROWS * COLS);
    seatIM.castShadow = false; seatIM.receiveShadow = true;
    // NOTE (r128): InstancedMesh.setColorAt allocates instanceColor as
    // Float32Array(3 * this.count) on first use — so `count` must still be the
    // FULL allocation while we fill. We track the used slots in `si` and trim
    // `count` at the end; zeroing it up front would silently drop every colour.
    let si = 0;
    const baseCol = new THREE.Color(P.seatA == null ? 0x2f4b70 : P.seatA);
    const altCol = new THREE.Color(P.seatB == null ? 0x3d6491 : P.seatB);
    const wordCol = new THREE.Color(P.wordColor == null ? 0xd8dee6 : P.wordColor);
    const mask = P.word ? wordMask(P.word, COLS, ROWS, P.wordPX || 3, P.wordPY || 2,
      P.wordRow == null ? Math.max(2, Math.floor(ROWS * 0.28)) : P.wordRow) : null;

    for (let r = 0; r < ROWS; r++) {
      const u = uBase + (r + 0.5) * TREAD;
      const y = plinth + r * RISE + 0.24;
      for (let c = 0; c < COLS; c++) {
        // aisles: two empty columns every AISLE_EVERY seats (stairs live there)
        const inAisle = (c % AISLE_EVERY) < 2 && c > 1 && c < COLS - 2;
        if (inAisle) continue;
        // vomitory portals punch through the bowl at mid height on two aisles
        if (P.voms !== false && r > ROWS * 0.34 && r < ROWS * 0.34 + 3 &&
            ((c % (AISLE_EVERY * 3)) < 5)) continue;
        const t = t0 + (t1 - t0) * (c + 0.5) / COLS;
        const f = S.frame(t);
        const px = f.x + f.nx * u, pz = f.z + f.nz * u;
        _Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.heading);
        _V.set(px, y, pz); _SC.set(1, 1, 1);
        _M.compose(_V, _Q, _SC);
        seatIM.setMatrixAt(si, _M);
        let col = ((r + (c >> 2)) & 1) ? altCol : baseCol;
        if (mask && mask(c, r)) col = wordCol;
        seatIM.setColorAt(si, col);
        si++;
        // a bounded, well-distributed set of seats holds REAL city actors;
        // every other seat is honestly empty (owner doctrine — no fake crowds).
        if (audience.length < cap && ((c + r * 7) % 23) === 3) {
          audience.push({
            x: px, y: y + 0.30, z: pz,
            yaw: Math.atan2(-f.nx, -f.nz), pose: "sit", state: "sit",
          });
        }
      }
    }
    seatIM.count = si;                       // trim to the seats we actually placed
    if (si) {
      seatIM.instanceMatrix.needsUpdate = true;
      if (seatIM.instanceColor) seatIM.instanceColor.needsUpdate = true;
      grp.add(seatIM);
    }

    // ---- 3. aisle stair treads + vomitory portals ----
    const stairMat = cmat(C.CONCRETE), voidMat = cmat(0x14181d);
    const stairIM = makeIM(stairMat, Math.ceil(COLS / AISLE_EVERY) * ROWS + 8, { noShadow: true });
    const vomIM = makeIM(voidMat, 12);
    // A VOMITORY IS A HOLE, AND A HOLE IS ONLY DRAWN WHERE THERE IS ONE.
    // The dark box went in at EVERY aisle while the seats it is supposed to be
    // the gap in were only skipped on every THIRD aisle — and the seat skip is
    // additionally gated on P.voms, which the box ignored entirely. So the two
    // small stands (voms:false) each carried ~8 near-black boxes standing in
    // the middle of their own seating with the seats still around them, and the
    // main stand carried 6 more than it had openings. That is the owner's "lone
    // gray box sitting mid-concourse on the stand". ONE condition now decides
    // both, and it is the seat loop's own condition, so they cannot disagree.
    const hasVom = function (c) { return P.voms !== false && (c % (AISLE_EVERY * 3)) < 5; };
    for (let c = 0; c < COLS; c += AISLE_EVERY) {
      if (c < 2 || c > COLS - 3) continue;
      const t = t0 + (t1 - t0) * (c + 1) / COLS;
      const f = S.frame(t);
      for (let r = 0; r < ROWS; r++) {
        const u = uBase + (r + 0.5) * TREAD;
        const y = plinth + r * RISE + 0.14;
        const x1 = f.x + f.nx * u - f.tx * SEAT_W, z1 = f.z + f.nz * u - f.tz * SEAT_W;
        const x2 = f.x + f.nx * u + f.tx * SEAT_W, z2 = f.z + f.nz * u + f.tz * SEAT_W;
        pushStrut(stairIM, x1, y, z1, x2, y, z2, 0.26);
      }
      if (!hasVom(c)) { propCut(1); continue; }
      // vomitory: the dark tunnel mouth, plus the concrete head over it that
      // turns a box on the treads into an OPENING you can see is an opening.
      const uv = uBase + ROWS * 0.34 * TREAD;
      const vy = plinth + ROWS * 0.34 * RISE + 1.1;
      const ax = f.x + f.nx * (uv - 1.2), az = f.z + f.nz * (uv - 1.2);
      const bx = f.x + f.nx * (uv + 2.6), bz = f.z + f.nz * (uv + 2.6);
      pushStrut(vomIM, ax, vy, az, bx, vy, bz, 2.2);
      box(grp, stairMat, (ax + bx) / 2, vy + 1.33, (az + bz) / 2,
        4.2, 0.46, 2.6, f.heading);                                     // the head
      propKeep(1, vy - 1.1, plinth + ROWS * 0.34 * RISE);
    }
    finishIM(grp, stairIM);
    finishIM(grp, vomIM);

    // ---- 4. back concourse facade + stair towers ----
    S.strip([{ u: uBack + 0.6, dy: 0.02, abs: true }, { u: uBack + 0.6, dy: topY + 1.1, abs: true }], {
      t0: t0, t1: t1, closed: false, step: 3.0, parent: grp,
      mat: cmat(C.STEEL), vLen: 6, name: "grandstand-back",
    });
    // hospitality/press band across the back — a lit ribbon of glazing
    S.strip([
      { u: uBack + 0.4, dy: topY - 2.4, abs: true, uv: 0 },
      { u: uBack + 0.4, dy: topY - 0.5, abs: true, uv: 1 },
    ], {
      t0: t0, t1: t1, closed: false, step: 3.0, parent: grp, vLen: 9,
      mat: new THREE.MeshLambertMaterial({
        color: 0x9ed4ea, emissive: 0x1b3a4a, emissiveIntensity: 0.35,
        transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false,
      }),
      name: "grandstand-press",
    });
    // STAIR CORES. Three featureless grey slabs per stand, at t0 / middle / t1
    // whatever the stand's length, is scatter — and a blank box is a
    // placeholder wearing a name. The count comes off the stand's own ARC (one
    // core per ~60 m of seating — real stand egress spacing — floored at two
    // because a bowl needs a way out at both ends, and capped at three so the
    // rule can only ever thin), and each core now reads as the building it
    // claims to be: a shaft with a doorway at grade you can actually walk to,
    // a glazed stair light up the concourse face, and a parapet that oversails.
    const cores = Math.max(2, Math.min(3, Math.round(arc / 60)));
    if (cores < 3) propCut(3 - cores);
    const coreCap = cmat(0x2a3038), coreDark = cmat(0x1d2229);
    const coreGlass = new THREE.MeshLambertMaterial({
      color: 0x9ed4ea, emissive: 0x14313f, emissiveIntensity: 0.3,
      transparent: true, opacity: 0.55, depthWrite: false,
    });
    for (let ci = 0; ci < cores; ci++) {
      const f = S.frame(t0 + (t1 - t0) * ci / (cores - 1));
      const ux = uBack + 3.2, CH = topY + 1.6;
      const px = f.x + f.nx * ux, pz = f.z + f.nz * ux;
      box(grp, cmat(C.STAND), px, CH / 2, pz, 5.2, CH, 6.4, f.heading);
      // the concourse sees the OUTBOARD face; that is where the door goes
      const uf = ux + 2.6;
      const fx = f.x + f.nx * uf, fz = f.z + f.nz * uf;
      box(grp, coreDark, fx, 1.25, fz, 0.26, 2.5, 2.0, f.heading);
      box(grp, coreGlass, fx, 1.4 + (CH - 3.4) / 2, fz, 0.18, CH - 3.4, 1.1, f.heading);
      box(grp, coreCap, px, CH + 0.28, pz, 5.9, 0.55, 7.1, f.heading);
      S.solid(px, pz, 6.4, 7.4, CH);
      propKeep(1, 0, 0);
    }

    // ---- 5. cantilever roof + truss ----
    const roofFrontU = uBase - 3.0, roofBackU = uBack + 4.2;
    const yFront = topY + 4.2, yBack = topY + 7.6;
    S.strip([
      { u: roofFrontU, dy: yFront, abs: true, uv: 0 },
      { u: roofBackU, dy: yBack, abs: true, uv: 1 },
    ], {
      t0: t0, t1: t1, closed: false, step: 4.0, parent: grp, vLen: 12,
      mat: cmat(0x3a4048), name: "grandstand-roof", doubleSide: true,
    });
    // fascia band on the leading edge — the biggest advertising surface here,
    // and the one the owner photographed upside down. It declared uv:1 on its
    // BOTTOM row and uv:0 on its top (every other band in the park is the other
    // way round), which flipped it vertically; the un-mirrored U axis then
    // flipped it horizontally, and the two together are a 180-degree rotation.
    // board() answers both from the geometry: a stand is outboard (u > 0), so
    // its fascia faces the racing line and nothing here states a uv at all.
    board(S, {
      t0: t0, t1: t1, u: roofFrontU, y0: yFront - 1.5, h: 1.5, abs: true,
      salt: P.fasciaSalt || 1, vLen: 16, thick: 0.22, back: "panel",
      backColor: 0x3a4048, capColor: 0x3a4048,
      parent: grp, name: "grandstand-fascia",
    });
    // truss: rafters + back columns + a Warren web between chords
    const steelMat = cmat(C.STEEL);
    const bays = Math.max(4, Math.round(arc / 7.5));
    const trussIM = makeIM(steelMat, bays * 9 + 12);
    for (let b = 0; b <= bays; b++) {
      const t = t0 + (t1 - t0) * b / bays;
      const f = S.frame(t);
      const fx = f.x + f.nx * roofFrontU, fz = f.z + f.nz * roofFrontU;
      const bx = f.x + f.nx * roofBackU, bz = f.z + f.nz * roofBackU;
      // bottom chord (rafter) and top chord
      pushStrut(trussIM, fx, yFront - 0.2, fz, bx, yBack - 0.2, bz, 0.26);
      pushStrut(trussIM, fx, yFront + 1.0, fz, bx, yBack + 1.1, bz, 0.20);
      // web members (zig-zag)
      const NW = 5;
      for (let w = 0; w < NW; w++) {
        const a = w / NW, c = (w + 1) / NW;
        const ax = fx + (bx - fx) * a, az = fz + (bz - fz) * a, ay = yFront + (yBack - yFront) * a;
        const cx = fx + (bx - fx) * c, cz = fz + (bz - fz) * c, cy = yFront + (yBack - yFront) * c;
        pushStrut(trussIM, ax, ay - 0.2, az, cx, cy + 1.0, cz, 0.13);
      }
      // back column down to the concourse
      const cux = uBack + 2.0;
      pushStrut(trussIM, f.x + f.nx * cux, yBack - 0.2, f.z + f.nz * cux,
        f.x + f.nx * cux, topY + 0.4, f.z + f.nz * cux, 0.42);
    }
    finishIM(grp, trussIM);

    // ---- 6. colliders: the stand is a building, not a hologram ----
    // A stand follows the CIRCUIT, so every chord but the odd one lies at an
    // angle, and a stand is DEEP (rows*0.95 + 4 ≈ 25 m on the main grandstand).
    // Bounding-boxing a 25 m deep block on a diagonal throws ~9 m of solid air
    // out over the apron in front of it and the same again out the back, which
    // is why the paddock side of this circuit felt walled off well short of the
    // seating. Registered with the tangent frame's own yaw instead.
    const CN = Math.max(6, Math.round(arc / 12));
    for (let i = 0; i < CN; i++) {
      const t = t0 + (t1 - t0) * (i + 0.5) / CN;
      const f = S.frame(t);
      const um = (uBase + uBack) / 2, ud = (uBack - uBase) + 4;
      const cxw = f.x + f.nx * um, czw = f.z + f.nz * um;
      const half = Math.abs(t1 - t0) * S.L / CN * 0.55;
      if (S.solidYaw && CBZ.orientedCollider) {
        // local +x on the TANGENT (along the rows), local +z on the NORMAL
        // (through the depth) — rotation.y maps local +x to world (cos,-sin).
        S.solidYaw(cxw, czw, half, ud / 2, Math.atan2(-f.tz, f.tx), 0, topY + 1.2);
      } else {
        const ex = Math.abs(f.tx) * half + Math.abs(f.nx) * ud / 2;
        const ez = Math.abs(f.tz) * half + Math.abs(f.nz) * ud / 2;
        S.solidBox(cxw - ex, cxw + ex, czw - ez, czw + ez, 0, topY + 1.2);
      }
    }

    if (P.sign && S.label) {
      const fm = S.frame((t0 + t1) / 2);
      const lab = S.label(P.sign, { color: "#ffd451" });
      if (lab) {
        lab.scale.set(22, 4.4, 1);
        lab.position.set(fm.x + fm.nx * (uBack + 1), topY + 9.6, fm.z + fm.nz * (uBack + 1));
        grp.add(lab);
      }
    }
    return audience;
  }

  // ================================================================== //
  //  PIT COMPLEX — pit road, pit boxes, pit wall + timing stands, and  //
  //  a garage block with real roller-door bays and a roof terrace.     //
  // ================================================================== //
  function pitComplex(S, P) {
    const C = S.C;
    const t0 = P.t0, t1 = P.t1;
    const LANE_IN = P.laneIn, LANE_OUT = P.laneOut;    // across-track u bounds
    const WALL_U = P.wallU;
    const Y = 0.10;                                     // pit apron is flat
    const grp = new THREE.Group(); grp.name = "speedway-pit-complex";
    S.root.add(grp);

    // ---- pit road surface (fast lane + working lane, painted split) ----
    S.strip([
      { u: LANE_IN, dy: Y, abs: true, uv: 0 },
      { u: LANE_OUT, dy: Y, abs: true, uv: 1 },
    ], {
      t0: t0, t1: t1, closed: false, step: 3.0, parent: grp, vLen: 14,
      mat: new THREE.MeshLambertMaterial({ map: pitLaneTex() }), name: "pit-road",
    });

    // ---- painted pit boxes + team numbers ----
    const BOXES = P.boxes || 12;
    const lineMat = cmat(C.LINE);
    const boxIM = makeIM(lineMat, BOXES * 3 + 4, { noShadow: true });
    for (let i = 0; i <= BOXES; i++) {
      const t = t0 + (t1 - t0) * i / BOXES;
      const f = S.frame(t);
      // stall divider running out from the wall into the working lane
      pushStrut(boxIM,
        f.x + f.nx * (WALL_U - 0.8), Y + 0.03, f.z + f.nz * (WALL_U - 0.8),
        f.x + f.nx * (LANE_IN + 4.4), Y + 0.03, f.z + f.nz * (LANE_IN + 4.4), 0.22);
      if (i < BOXES) {
        const tm = t0 + (t1 - t0) * (i + 0.5) / BOXES;
        const fm = S.frame(tm);
        if (S.label) {
          const lab = S.label(String(i + 1), { color: "#ffd451" });
          if (lab) {
            lab.scale.set(2.4, 0.9, 1);
            lab.position.set(fm.x + fm.nx * (WALL_U - 3.0), Y + 1.5, fm.z + fm.nz * (WALL_U - 3.0));
            grp.add(lab);
          }
        }
      }
    }
    finishIM(grp, boxIM);
    // the pit-lane speed-limit blend line (solid, along the fast lane edge)
    S.strip([
      { u: LANE_IN + 4.6, dy: Y + 0.02, abs: true },
      { u: LANE_IN + 4.9, dy: Y + 0.02, abs: true },
    ], { t0: t0, t1: t1, closed: false, step: 3.0, parent: grp, mat: cmat(0xf0c419), name: "pit-fastlane" });

    // ---- pit wall (sponsor-faced) + timing stands on top ----
    // A pit wall has TWO audiences — the grandstand across the track and the
    // crew standing behind it — so it is the one board in the park printed on
    // both faces, and each face gets its own U direction. The track is at u = 0,
    // outboard of a wall at u = -26, so the read face is the +u one.
    board(S, {
      t0: t0, t1: t1, u: WALL_U + 0.35, y0: Y, h: 1.05, abs: true, face: 1,
      thick: 0.7, back: "read", backMap: sponsorBand(8, 96), capColor: 0xb7bcc2,
      salt: 4, vLen: 12, step: 2.6, parent: grp, name: "pit-wall",
    });
    // pit wall colliders (a chain of AABBs — cars bounce off it like a wall)
    S.solidChain(t0, t1, WALL_U, 0.9, 0, 1.25, 3.0);
    const standMat = cmat(0x2a3038), monMat = new THREE.MeshLambertMaterial({
      color: 0x0d1218, emissive: 0x2e5a8a, emissiveIntensity: 0.55,
    });
    for (let i = 0; i < BOXES; i++) {
      const t = t0 + (t1 - t0) * (i + 0.5) / BOXES;
      const f = S.frame(t);
      // same frame note as the garage bays: w is ACROSS the lane, d ALONG it.
      // A timing stand is long along the pit lane and shallow across it, and a
      // monitor bank and a team board are thin plates FACING the lane.
      const sx = f.x + f.nx * (WALL_U + 0.9), sz = f.z + f.nz * (WALL_U + 0.9);
      box(grp, standMat, sx, Y + 1.9, sz, 1.5, 0.18, 3.4, f.heading);      // gantry deck
      box(grp, standMat, sx, Y + 1.0, sz, 0.2, 1.8, 0.2, f.heading);       // leg
      const mx = f.x + f.nx * (WALL_U + 0.35), mz = f.z + f.nz * (WALL_U + 0.35);
      box(grp, monMat, mx, Y + 2.5, mz, 0.1, 0.9, 2.6, f.heading);         // monitor bank
      box(grp, cmat(PANEL_BG[i % PANEL_BG.length]), sx, Y + 2.55, sz, 0.12, 1.0, 3.4, f.heading);
      propKeep(2, Y + 2.05, Y + 2.05);
    }

    // ---- garage block: 12 bays with roller doors + roof terrace ----
    const GF = P.garageFront, GD = P.garageDepth || 15, GH = 7.4;
    const concrete = cmat(0x757b84), roofM = cmat(0x3a4149), doorM = cmat(0xb9c1c9),
      trimM = cmat(0x1d2229), warm = cmat(0xe5b34e, { emissive: 0xe5b34e, ei: 0.5 });
    // slab + roof as swept ribbons so the whole block follows the tri-oval
    S.strip([
      { u: GF, dy: Y, abs: true }, { u: GF - GD, dy: Y, abs: true },
    ], { t0: t0, t1: t1, closed: false, step: 4.0, parent: grp, mat: concrete, name: "garage-slab" });
    S.strip([
      { u: GF + 1.4, dy: GH, abs: true }, { u: GF - GD - 0.8, dy: GH + 0.9, abs: true },
    ], { t0: t0, t1: t1, closed: false, step: 4.0, parent: grp, mat: roofM, name: "garage-roof", doubleSide: true });
    // roof terrace railing (VIP viewing deck over the pits)
    const railIM = makeIM(cmat(0x9aa3ad), Math.round(Math.abs(t1 - t0) * S.L / 2.4) + 8, { noShadow: true });
    {
      const nR = Math.max(8, Math.round(Math.abs(t1 - t0) * S.L / 2.4));
      let prev = null;
      for (let i = 0; i <= nR; i++) {
        const t = t0 + (t1 - t0) * i / nR;
        const f = S.frame(t);
        const rx = f.x + f.nx * (GF + 1.2), rz = f.z + f.nz * (GF + 1.2);
        pushStrut(railIM, rx, GH, rz, rx, GH + 1.05, rz, 0.09);
        if (prev) pushStrut(railIM, prev[0], GH + 1.0, prev[1], rx, GH + 1.0, rz, 0.08);
        prev = [rx, rz];
      }
    }
    finishIM(grp, railIM);
    // back wall of the garage block + colliders
    S.strip([
      { u: GF - GD, dy: Y, abs: true }, { u: GF - GD, dy: GH, abs: true },
    ], { t0: t0, t1: t1, closed: false, step: 3.0, parent: grp, mat: concrete, name: "garage-back" });
    S.solidChain(t0, t1, GF - GD + 0.3, 1.0, 0, GH, 3.2);
    // the bays themselves: pier, roller door, lintel, bay number, tool bench
    //
    // FRAME NOTE, and it is the same fault class as the upside-down boards.
    // `box(..., w, h, d, yaw)` builds BoxGeometry(w, h, d) and yaws it, so with
    // yaw = f.heading the WIDTH lies along local +X and the DEPTH along local
    // +Z — and island_speedway.js's own published basis (surfMatrix: "+Z along
    // the tangent, +X = Y x Z") says local +Z is ALONG the track and local +X
    // is ACROSS it. Every plate below was authored the other way round: a
    // roller door written (bayLen - 1.4, dh, 0.16) came out 11.6 m deep ACROSS
    // the frontage and 0.16 m wide along it — twelve fins standing through the
    // garage front and out into the pit lane, instead of twelve doors closing
    // twelve bays. The numbers were right; only the two slots were swapped.
    const tyreIM = new THREE.InstancedMesh(tyreGeom(), cmat(0x1b1d20), BOXES * 4);
    tyreIM.count = 0; tyreIM.castShadow = false; tyreIM.receiveShadow = true;
    for (let i = 0; i < BOXES; i++) {
      const ta = t0 + (t1 - t0) * i / BOXES, tb = t0 + (t1 - t0) * (i + 1) / BOXES;
      const tm = (ta + tb) / 2;
      const fa = S.frame(ta), fm = S.frame(tm);
      const bayLen = Math.abs(tb - ta) * S.L;
      // pier between bays
      box(grp, concrete, fa.x + fa.nx * (GF - 0.4), Y + GH / 2, fa.z + fa.nz * (GF - 0.4),
        1.6, GH, 1.1, fa.heading);
      // roller door, part-raised so the bay reads as OPEN and working
      const raise = 2.2 + ((i * 7) % 5) * 0.55;
      const dh = Math.max(0.6, GH - 1.0 - raise);
      box(grp, doorM, fm.x + fm.nx * (GF - 0.15), Y + GH - 0.5 - dh / 2, fm.z + fm.nz * (GF - 0.15),
        0.16, dh, bayLen - 1.4, fm.heading);
      // lintel + illuminated bay number strip
      box(grp, trimM, fm.x + fm.nx * (GF - 0.15), Y + GH - 0.35, fm.z + fm.nz * (GF - 0.15),
        0.34, 0.7, bayLen - 1.0, fm.heading);
      box(grp, warm, fm.x + fm.nx * (GF - 0.02), Y + GH - 0.35, fm.z + fm.nz * (GF - 0.02),
        0.1, 0.34, bayLen * 0.42, fm.heading);
      // inside the bay: a tool bench you cannot walk through, and the bay's
      // spare set — REAL tyres, out of the same one geometry the trackside
      // tyre walls are stacked from, instead of the featureless black cube
      // that used to stand in for a wheel rack. All 12 bays are ONE draw.
      const bx = fm.x + fm.nx * (GF - GD + 1.6), bz = fm.z + fm.nz * (GF - GD + 1.6);
      box(grp, cmat(0x2f353d), bx, Y + 0.45, bz, 0.7, 0.9, bayLen - 2.2, fm.heading);
      const bex = Math.abs(fm.tx) * (bayLen - 2.2) / 2 + Math.abs(fm.nx) * 0.35;
      const bez = Math.abs(fm.tz) * (bayLen - 2.2) / 2 + Math.abs(fm.nz) * 0.35;
      S.solidBox(bx - bex, bx + bex, bz - bez, bz + bez, 0, Y + 0.9);
      propKeep(1, Y, Y);
      const wx = fm.x + fm.nx * (GF - GD + 3.4), wz = fm.z + fm.nz * (GF - GD + 3.4);
      for (let k = 0; k < 4; k++) {
        if (tyreIM.count >= tyreIM.instanceMatrix.count) break;
        _Q.identity(); _SC.set(1, 1, 1);
        _V.set(wx, Y + 0.18 + k * 0.34, wz);
        _M.compose(_V, _Q, _SC);
        tyreIM.setMatrixAt(tyreIM.count++, _M);
      }
      S.solid(wx, wz, 1.5, 1.5, Y + 1.4);
      propKeep(1, Y, Y);
    }
    if (tyreIM.count) { tyreIM.instanceMatrix.needsUpdate = true; grp.add(tyreIM); }
    if (S.label) {
      const fm = S.frame((t0 + t1) / 2);
      const lab = S.label("PIT LANE", { color: "#ffd451" });
      if (lab) {
        lab.scale.set(12, 2.8, 1);
        lab.position.set(fm.x + fm.nx * (GF - GD / 2), GH + 4.0, fm.z + fm.nz * (GF - GD / 2));
        grp.add(lab);
      }
    }
    return grp;
  }

  let _pitTex = null;
  function pitLaneTex() {
    if (_pitTex) return _pitTex;
    const W = 256, H = 256, cv = canvas(W, H), g = cv.getContext("2d");
    g.fillStyle = "#3a3e44"; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1400; i++) {
      const x = (i * 53) % W, y = (i * 97) % H;
      const v = 52 + ((i * 31) % 26);
      g.fillStyle = "rgba(" + v + "," + (v + 2) + "," + (v + 6) + ",0.5)";
      g.fillRect(x, y, 2, 2);
    }
    // concrete slab joints across the lane
    g.strokeStyle = "rgba(20,22,26,.5)"; g.lineWidth = 2;
    for (let y = 0; y < H; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    // edge lines
    g.fillStyle = "#e8edf3";
    g.fillRect(0, 0, 6, H); g.fillRect(W - 6, 0, 6, H);
    _pitTex = texFrom(cv, false, true);
    return _pitTex;
  }

  // ================================================================== //
  //  A FLAT SIGN FACE READS FROM ONE SIDE ONLY.                        //
  //                                                                     //
  //  board() above solves this for SWEPT ribbons. The park also carries  //
  //  FLAT rigid signs — the start/finish gantry name, the scoring        //
  //  pylon's position boards, the jumbotron — and every one of them was  //
  //  a mapped BOX. A box carries the same map on its far face, where the //
  //  U axis that ran to your right from the front runs to your LEFT: it  //
  //  is the same mirrored text the owner photographed on the sponsor     //
  //  bands, and `side: DoubleSide` produces it for free on one quad.     //
  //                                                                     //
  //  So a flat sign is ONE PlaneGeometry per read direction, one-sided,  //
  //  yawed so its own +Z is the presented face — the pattern the venue   //
  //  monument and the gatehouse title beam already use. Its own +X is    //
  //  then the reader's right (F = -n, R = F x y_hat = local +X), and     //
  //  r128's PlaneGeometry puts U = 0 at -X, U = 1 at +X and V = 1 on the //
  //  TOP row, which is where a flipY CanvasTexture's first canvas row    //
  //  lands. Both axes therefore come out right with no uv arithmetic at  //
  //  the call site, exactly as boardFace() manages for a ribbon.         //
  //                                                                     //
  //  `proud` is the other half of the owner's report — the FLICKER. A    //
  //  face bolted to a casing sits a few centimetres in FRONT of it AND   //
  //  carries polygonOffset, because a positional nudge alone still ties  //
  //  in the depth buffer at distance and a depth tie is what shimmers    //
  //  when you move. That pairing is the house pattern (playercars.js's   //
  //  cab glass, race_livery.js's door numbers, buildings.js's decals).   //
  // ================================================================== //
  const _signs = [];        // {mesh, nx, nz} — flat faces, audited from BUFFERS

  function signOffset(m) {
    // never on a cmat() material: those are SHARED across the whole world and
    // a depth bias set here would follow them everywhere.
    if (!m || m._shared || m.polygonOffset) return m;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -1;
    return m;
  }

  function signFace(parent, o) {
    const yaw = o.yaw || 0;
    const nx = Math.sin(yaw), nz = Math.cos(yaw);     // the presented face's normal
    const proud = o.proud == null ? 0 : o.proud;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), signOffset(o.mat));
    mesh.position.set(o.x + nx * proud, o.y, o.z + nz * proud);
    mesh.rotation.y = yaw;
    mesh.name = o.name || "speedway-sign-face";
    mesh.userData.speedway = true;         // keep it out of the inert merge pass
    if (parent) parent.add(mesh);
    _signs.push({ mesh: mesh, nx: nx, nz: nz });
    return mesh;
  }

  // ================================================================== //
  //  SCORING PYLON + JUMBOTRON                                          //
  // ================================================================== //
  //  THE LEGS STAND BEHIND THE BOARDS, NOT ACROSS THEM. Two independent //
  //  faults put a 0.28 m lattice leg through the readable face:         //
  //                                                                     //
  //  (1) the lattice was laid out on the WORLD axes while the boards     //
  //      were placed on the pylon's own heading, so how much leg crossed //
  //      a board depended on where in the infield the thing happened to  //
  //      be pointing. At heading 45 deg a leg projects 1.9*s*sqrt(2) —   //
  //      2.33 m at the board's foot — onto a board face at 1.9 m, dead   //
  //      centre. The legs are now built in the BOARDS' frame, so a leg   //
  //      sits on the 45 deg diagonal BETWEEN two boards by construction  //
  //      and its projection onto either normal is exactly its half-span. //
  //  (2) even then the half-span (1.9*0.868 = 1.65 m at the foot, plus   //
  //      0.14*sqrt(2) of strut corner) reached 1.85 m, INSIDE the        //
  //      1.78-2.02 m the board casing occupied — an interpenetration,    //
  //      i.e. a depth tie, i.e. the flicker. The base spread is trimmed  //
  //      to 1.80 and the boards pushed out to 2.15, which buys 0.27 m of //
  //      daylight at the worst point (the board's foot) and grows with   //
  //      height as the taper closes. The silhouette loses 0.1 m of base  //
  //      half-spread and the boards still overhang the lattice corners.  //
  // ================================================================== //
  function pylon(S, x, z, heading) {
    const grp = new THREE.Group(); grp.name = "speedway-scoring-pylon";
    S.root.add(grp);
    const steel = cmat(0x2b3138), dark = cmat(0x14181d);
    const H = 34;
    const LEGR = 1.80;                       // lattice half-spread at the foot
    const BOARD_U = 2.15, BOARD_W = 3.6, BOARD_T = 0.24;
    const BOARD_Y0 = 10, BOARD_H = 20;
    // the pylon's own frame: aX is board 0's outward normal, bX board 1's.
    const aX = Math.sin(heading), aZ = Math.cos(heading);
    const bX = Math.cos(heading), bZ = -Math.sin(heading);
    // tapered lattice core: 4 legs + ring bracing, on the board diagonals
    const legIM = makeIM(steel, 4 * 14 + 40);
    const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const RINGS = 12;
    function legXZ(i, h) {
      const s = LEGR * (1 - 0.45 * (h / H));
      const p = legs[i][0] * s, q = legs[i][1] * s;
      return [x + aX * p + bX * q, z + aZ * p + bZ * q];
    }
    for (let i = 0; i < 4; i++) {
      for (let r = 0; r < RINGS; r++) {
        const h0 = H * r / RINGS, h1 = H * (r + 1) / RINGS;
        const a = legXZ(i, h0), b = legXZ(i, h1);
        pushStrut(legIM, a[0], h0, a[1], b[0], h1, b[1], 0.28);
        const j = (i + 1) % 4;
        const c = legXZ(j, h1);
        pushStrut(legIM, a[0], h0, a[1], c[0], h1, c[1], 0.14);
      }
    }
    finishIM(grp, legIM);
    // The position board: ONE emissive read face per side, standing proud of a
    // plain dark casing. The casing is four instances of the shared unit cube,
    // so the whole rack of housings is a single draw and no housing carries a
    // map that could read backwards from inside the lattice.
    const boardTex = screenTex([
      { text: "1", right: "#7" }, { text: "2", right: "#22" }, { text: "3", right: "#4" },
      { text: "4", right: "#18" }, { text: "5", right: "#9" }, { text: "6", right: "#31" },
    ], 256, 512);
    const boardMat = new THREE.MeshLambertMaterial({ map: boardTex, emissive: 0xffffff, emissiveIntensity: 0.35, emissiveMap: boardTex });
    const caseIM = makeIM(dark, 4);
    const boardY = BOARD_Y0 + BOARD_H / 2;
    for (let s = 0; s < 4; s++) {
      const a = heading + s * Math.PI / 2;
      const px = x + Math.sin(a) * BOARD_U, pz = z + Math.cos(a) * BOARD_U;
      if (caseIM.count < caseIM.instanceMatrix.count) {
        _Q.setFromAxisAngle(_YAX, a);
        _V.set(px, boardY, pz); _SC.set(BOARD_W, BOARD_H, BOARD_T);
        _M.compose(_V, _Q, _SC);
        caseIM.setMatrixAt(caseIM.count++, _M);
      }
      signFace(grp, {
        x: px, y: boardY, z: pz, yaw: a, w: BOARD_W, h: BOARD_H,
        mat: boardMat, proud: BOARD_T / 2 + 0.04, name: "pylon-board-" + s,
      });
    }
    finishIM(grp, caseIM);
    box(grp, dark, x, H + 0.9, z, 5.2, 1.8, 5.2);
    box(grp, cmat(0xc23a36, { emissive: 0xc23a36, ei: 0.55 }), x, H + 2.6, z, 3.0, 1.6, 3.0);
    if (S.label) {
      const lab = S.label("DIAMOND SPEEDWAY", { color: "#ffd451" });
      if (lab) { lab.scale.set(16, 3.4, 1); lab.position.set(x, H + 5.6, z); grp.add(lab); }
    }
    return { group: grp, tex: boardTex };
  }

  function jumbotron(S, x, z, heading, w, h) {
    const grp = new THREE.Group(); grp.name = "speedway-jumbotron";
    S.root.add(grp);
    const steel = cmat(0x2b3138);
    const W = w || 20, Hh = h || 11, BASE = 9;
    const tex = screenTex([
      { text: "DIAMOND SPEEDWAY", color: "#ffd451" },
      { text: "GRAND CIRCUIT", color: "#9fe6c8", right: "LIVE", rightColor: "#ff5a5a" },
    ], 512, 256);
    const screen = new THREE.MeshLambertMaterial({
      map: tex, emissive: 0xffffff, emissiveIntensity: 0.55, emissiveMap: tex,
    });
    // THE FRAME STANDS BEHIND THE SCREEN AND OUTSIDE IT. The two 0.55 m
    // columns were placed 1.2 m INBOARD of a 22 m screen's edges and at the
    // screen's own depth, so each one drew straight through 0.55 m of readable
    // face for the screen's whole height; the rear rakers started on the same
    // point. Everything structural now sits at local z = LEG_Z, which is
    // BEHIND the casing's back face, and at |local x| = LEG_U, which is
    // outboard of the casing's edge — so the screen is unobstructed from its
    // read direction by construction rather than by luck.
    //   local +X = across the screen, local +Z = the way it is READ.
    const rx = Math.cos(heading), rz = -Math.sin(heading);
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const CY = BASE + Hh / 2;
    const CASE_D = 0.5, CASE_Z = -0.35;                  // casing centre, local +Z
    const CASE_FRONT = CASE_Z + CASE_D / 2;              // -0.10
    const CASE_BACK = CASE_Z - CASE_D / 2;               // -0.60
    box(grp, cmat(0x14181d), x + fx * CASE_Z, CY, z + fz * CASE_Z,
      W + 1.2, Hh + 1.2, CASE_D, heading);
    signFace(grp, {
      x: x + fx * CASE_FRONT, y: CY, z: z + fz * CASE_FRONT, yaw: heading,
      w: W, h: Hh, mat: screen, proud: 0.06, name: "jumbotron-screen",
    });
    // support frame
    const frameIM = makeIM(steel, 40);
    const LEG_U = W / 2 + 1.1;              // clear of the casing edge, (W+1.2)/2
    const LEG_Z = CASE_BACK - 0.45;         // 0.175 m of daylight behind the casing
    for (const s of [-1, 1]) {
      const lx = x + rx * s * LEG_U + fx * LEG_Z, lz = z + rz * s * LEG_U + fz * LEG_Z;
      pushStrut(frameIM, lx, 0, lz, lx, BASE + Hh, lz, 0.55);
      // rear raker holding the screen up against the wind
      pushStrut(frameIM, lx, BASE + Hh * 0.8, lz, lx - fx * 7, 0, lz - fz * 7, 0.35);
    }
    for (let i = 0; i < 4; i++) {
      const y = BASE * (i / 3);
      pushStrut(frameIM, x + rx * LEG_U + fx * LEG_Z, y, z + rz * LEG_U + fz * LEG_Z,
        x - rx * LEG_U + fx * LEG_Z, y, z - rz * LEG_U + fz * LEG_Z, 0.24);
    }
    finishIM(grp, frameIM);
    S.solidBox(x - W / 2, x + W / 2, z - 4, z + 4, 0, 3.0);
    return { group: grp, tex: tex };
  }

  // ================================================================== //
  //  FLOODLIGHT MASTS — a real lattice mast with a lamp ARRAY, not a    //
  //  lamppost with a box on it.                                         //
  // ================================================================== //
  function floodlights(S, spots) {
    const grp = new THREE.Group(); grp.name = "speedway-floodlights";
    S.root.add(grp);
    const steel = cmat(0x6a6f76);
    const lamp = cmat(0xeef2f6, { emissive: 0xfff4d0, ei: 0.85 });
    const H = 34, LEG = 2.4;
    const latticeIM = makeIM(steel, spots.length * (4 * 10 + 4 * 10 + 12));
    const lampIM = makeIM(lamp, spots.length * 30, { noShadow: true });
    const armIM = makeIM(steel, spots.length * 10);
    for (const sp of spots) {
      const x = sp.x, z = sp.z;
      const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const RINGS = 10;
      const tap = function (h) { return LEG * (1 - 0.55 * (h / H)); };
      for (let i = 0; i < 4; i++) {
        for (let r = 0; r < RINGS; r++) {
          const h0 = H * r / RINGS, h1 = H * (r + 1) / RINGS;
          const s0 = tap(h0), s1 = tap(h1);
          const a = [x + legs[i][0] * s0, z + legs[i][1] * s0];
          const b = [x + legs[i][0] * s1, z + legs[i][1] * s1];
          pushStrut(latticeIM, a[0], h0, a[1], b[0], h1, b[1], 0.22);
          const j = (i + 1) % 4;
          const c = [x + legs[j][0] * s1, z + legs[j][1] * s1];
          pushStrut(latticeIM, a[0], h0, a[1], c[0], h1, c[1], 0.12);
        }
      }
      // head frame: two cross-arms carrying a 5 x 3 luminaire array aimed
      // at the track centre.
      const ang = Math.atan2(sp.ax - x, sp.az - z);
      const rx = Math.cos(ang), rz = -Math.sin(ang);
      for (let row = 0; row < 3; row++) {
        const y = H + 1.2 + row * 1.35;
        pushStrut(armIM, x - rx * 5.2, y, z - rz * 5.2, x + rx * 5.2, y, z + rz * 5.2, 0.2);
        for (let c = 0; c < 5; c++) {
          const o = (c - 2) * 2.4;
          const lx = x + rx * o + Math.sin(ang) * 0.55, lz = z + rz * o + Math.cos(ang) * 0.55;
          if (lampIM.count < lampIM.instanceMatrix.count) {
            _Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
            _V.set(lx, y, lz); _SC.set(1.7, 0.95, 0.55);
            _M.compose(_V, _Q, _SC);
            lampIM.setMatrixAt(lampIM.count++, _M);
          }
        }
      }
      S.solidBox(x - LEG, x + LEG, z - LEG, z + LEG, 0, 6);
    }
    finishIM(grp, latticeIM);
    finishIM(grp, armIM);
    finishIM(grp, lampIM);
    return grp;
  }

  // ================================================================== //
  //  A BOARD READS FROM ITS OWN FACE — the ONE sponsor panel builder.  //
  //                                                                     //
  //  OWNER: "the racing stadium has these UPSIDE DOWN BRANDS."           //
  //                                                                     //
  //  It was two independent arithmetic faults on one surface, and the    //
  //  cure is to stop letting a caller state either answer by hand.       //
  //                                                                     //
  //  (1) THE VERTICAL AXIS IS DECIDED BY WORLD HEIGHT, NOT ROW ORDER.    //
  //      THREE.CanvasTexture inherits flipY = true, so canvas row 0 —    //
  //      the top of the artwork, where the ascenders are — lands at      //
  //      V = 1 and the last canvas row at V = 0. A board therefore reads //
  //      upright IFF its LOWEST vertex carries V = 0 and its highest     //
  //      V = 1. That is an inequality, not a convention, and every band  //
  //      in the park honoured it except the grandstand roof fascia,      //
  //      which declared uv:1 on its BOTTOM row and uv:0 on its top.      //
  //                                                                     //
  //  (2) THE HORIZONTAL AXIS IS DECIDED BY WHICH FACE YOU READ FROM.     //
  //      strip() puts the along-track parameter w on U when swapUV is    //
  //      set. For a two-row vertical profile the front-face normal is    //
  //      (b-a) x (c-a) = y_hat x T = (tz, 0, -tx) = -n_hat when the rows //
  //      run bottom->top, and +n_hat when they run top->bottom. A reader //
  //      on that face has forward F = -normal and right R = F x y_hat,   //
  //      which works out to R = -T for the first case and R = +T for the //
  //      second. Text must run along the reader's RIGHT, so U has to be  //
  //      mirrored (1 - w) exactly when the presented face looks along    //
  //      -n_hat. Nothing in this file did that, so EVERY sponsor band in //
  //      the park read right-to-left; combined with (1) the roof fascia  //
  //      came out rotated a full 180 degrees, which is what the owner    //
  //      photographed (the panel sequence he read off the screenshot     //
  //      steps -5 through SPONSORS, the exact reverse of the +5 the      //
  //      canvas paints).                                                 //
  //                                                                     //
  //  So a caller states a POSITION and an OUTWARD DIRECTION and gets an  //
  //  upright board; it never writes a uv or a row order again. `face` is //
  //  +1 when the reader stands OUTBOARD (larger u) and -1 when the       //
  //  reader stands INBOARD, and it defaults to -sign(u) because a        //
  //  trackside board faces the racing line. Cost: a one-sided read face  //
  //  is the same ONE draw the old DoubleSide quad was; a real board with //
  //  a back and a capping rail is three, and it is three because a       //
  //  single strip cannot carry two opposite U directions without         //
  //  shearing the cap between them.                                      //
  // ================================================================== //
  const _boards = [];                       // {mesh, face} — audited from BUFFERS

  function boardFace(S, o, u, face, m, name) {
    const lo = o.y0 == null ? 0.05 : o.y0;
    const hi = lo + (o.h == null ? 1.15 : o.h);
    const abs = o.abs !== false;
    const rows = face > 0
      ? [{ u: u, dy: hi, abs: abs, uv: 1 }, { u: u, dy: lo, abs: abs, uv: 0 }]
      : [{ u: u, dy: lo, abs: abs, uv: 0 }, { u: u, dy: hi, abs: abs, uv: 1 }];
    // THE ONE CHOKE POINT FOR THE FLICKER, TOO. Every board in the park —
    // fascias, pit wall, SAFER band, inner wall, hoardings — is a pair of
    // faces `thick` apart with a cap rail bridging them, and the thinnest pair
    // (the hoardings, 0.14 m) is thin enough to tie in the depth buffer once
    // it is far enough away. The house pattern is a NEGATIVE polygon offset on
    // the printed face (playercars.js's cab glass, race_livery.js's numbers),
    // and putting it here fixes every board() consumer at once. signOffset()
    // refuses to touch a shared cmat() material, so the plain backing panels
    // and cap rails are left exactly as they were.
    const mesh = S.strip(rows, {
      t0: o.t0, t1: o.t1, closed: !!o.closed, step: o.step || 3.0,
      parent: o.parent, vLen: o.vLen || 11, swapUV: true, uFlip: face < 0,
      mat: signOffset(m), name: name, cast: !!o.cast,
    });
    if (mesh) _boards.push({ mesh: mesh, face: face });
    return mesh;
  }

  /* board(S, o)
       o.t0,o.t1,o.closed,o.step   the run along the racing line
       o.u                         across-track offset of the READ face
       o.y0,o.h,o.abs              foot + height (abs:false = above the surface)
       o.face                      +1 read from outboard, -1 from inboard;
                                   default -sign(u) — it faces the racing line
       o.salt / o.map / o.vLen     the artwork
       o.thick                     board depth; the back face sits at
                                   u - face*thick
       o.back                      "read" (printed both sides, each face given
                                   its OWN U direction) | "panel" (plain
                                   backing). There is deliberately no
                                   single-quad option: a mapped DoubleSide quad
                                   reads MIRRORED from behind, which is the
                                   exact defect this builder exists to end, and
                                   the branch that offered one had no callers.
       o.capColor / o.cap:false    the capping rail across the top
     Returns {group, faces}. */
  function board(S, o) {
    const face = o.face == null ? (o.u > 0 ? -1 : 1) : (o.face < 0 ? -1 : 1);
    const tex = o.map || sponsorBand(o.salt == null ? 1 : o.salt, o.texH || 96);
    const back = o.back == null ? "panel" : o.back;
    const thick = o.thick == null ? 0.12 : o.thick;
    const faces = [];
    const uBack = o.u - face * thick;
    faces.push(boardFace(S, o, o.u, face, new THREE.MeshLambertMaterial({ map: tex }),
      (o.name || "board") + "-face"));
    faces.push(boardFace(S, o, uBack, -face,
      back === "read"
        ? new THREE.MeshLambertMaterial({ map: o.backMap || tex })
        : cmat(o.backColor == null ? 0x3c424a : o.backColor),
      (o.name || "board") + "-back"));
    if (o.cap !== false) {
      // the capping rail. Rows must run inner -> outer (increasing u): that is
      // the order strip() turns into an UPWARD-facing triangle.
      const lo = o.y0 == null ? 0.05 : o.y0;
      const hi = lo + (o.h == null ? 1.15 : o.h);
      const abs = o.abs !== false;
      const uA = Math.min(o.u, uBack), uB = Math.max(o.u, uBack);
      S.strip([{ u: uA, dy: hi, abs: abs }, { u: uB, dy: hi, abs: abs }], {
        t0: o.t0, t1: o.t1, closed: !!o.closed, step: o.step || 3.0,
        parent: o.parent, mat: cmat(o.capColor == null ? 0xb9c0c8 : o.capColor),
        name: (o.name || "board") + "-cap",
      });
    }
    return { group: o.parent, faces: faces };
  }

  /* A WORLD REBUILD MAKES A NEW PARK. Both ledgers are per-BUILD, so the
     landmass builder clears them before it draws anything — otherwise a second
     world would report the first one's boards (whose buffers are gone) and
     double its prop counts. Called once, from where the S contract is declared. */
  function buildReset() {
    _boards.length = 0;
    _signs.length = 0;
    PROPS.kept = 0; PROPS.cut = 0; PROPS.floating = 0;
  }

  /* THE RATCHET. Not a counter a build loop kept: it re-reads the POSITION and
     UV buffers of every board AND every flat sign face actually in the scene
     and re-runs the tests the two helpers are built on, so a face that stops
     being upright fails even if it was drawn by code that believes it is fine.
     `flipped` is pinned at 0 and `faces` may only ever RISE.

     The swept boards and the flat signs are audited separately because their
     buffers are laid out differently — strip() emits (row, profile) pairs, a
     PlaneGeometry emits its four corners top row first — and folding them into
     one loop is how you get a test that is vacuously true for one of them. */
  function boardAudit() {
    let flipped = 0, faces = 0, vFlip = 0, uFlip = 0, twoSided = 0, offNormal = 0;
    for (let i = 0; i < _boards.length; i++) {
      const rec = _boards[i], g = rec.mesh && rec.mesh.geometry;
      if (!g || !g.attributes || !g.attributes.uv || !g.attributes.position) continue;
      const p = g.attributes.position, uv = g.attributes.uv;
      if (p.count < 4) continue;
      faces++;
      // vertices 0,1 are the two profile rows at the first along-track sample;
      // vertex 2 is row 0 again at the NEXT sample (strip lays out i*n + j).
      let bad = 0;
      if ((p.getY(1) - p.getY(0)) * (uv.getY(1) - uv.getY(0)) <= 0) { vFlip++; bad = 1; }
      // U must rise along the reader's right: +T for an outboard reader, -T for
      // an inboard one. Vertex 0 -> 2 walks +T by construction.
      if ((uv.getX(2) - uv.getX(0)) * (rec.face > 0 ? 1 : -1) <= 0) { uFlip++; bad = 1; }
      flipped += bad;
    }
    // --- the FLAT sign faces (gantry name, pylon boards, jumbotron) ---------
    let signs = 0;
    for (let i = 0; i < _signs.length; i++) {
      const rec = _signs[i], mesh = rec.mesh, g = mesh && mesh.geometry;
      if (!g || !g.attributes || !g.attributes.uv || !g.attributes.position) continue;
      const p = g.attributes.position, uv = g.attributes.uv;
      if (p.count < 4) continue;
      faces++; signs++;
      let bad = 0;
      // r128's PlaneGeometry emits the TOP row first, so vertex 0 is the top
      // left corner and vertex 2 the bottom left. V must rise with height.
      if ((p.getY(0) - p.getY(2)) * (uv.getY(0) - uv.getY(2)) <= 0) { vFlip++; bad = 1; }
      // U must rise along the reader's right, which for a plane presenting its
      // own +Z is its own +X. A mirrored scale flips that in the MATRIX rather
      // than in the buffer, so the sign of scale.x is part of the test.
      const sx = mesh.scale.x < 0 ? -1 : 1;
      if ((p.getX(1) - p.getX(0)) * (uv.getX(1) - uv.getX(0)) * sx <= 0) { uFlip++; bad = 1; }
      // A DoubleSide text face IS the mirrored-text defect whatever its buffers
      // say — the back of a mapped quad runs U the other way by definition.
      const m = mesh.material;
      if (m && m.side === THREE.DoubleSide) { twoSided++; bad = 1; }
      // and the face must actually look the way its author said it does.
      const yaw = mesh.rotation.y;
      if (Math.sin(yaw) * rec.nx + Math.cos(yaw) * rec.nz <= 0.001) { offNormal++; bad = 1; }
      flipped += bad;
    }
    return { boards: _boards.length, signs: signs, faces: faces, flipped: flipped,
             vFlipped: vFlip, uFlipped: uFlip, twoSided: twoSided,
             offNormal: offNormal };
  }

  // ================================================================== //
  //  TRACKSIDE ADVERTISING HOARDINGS — every run through board().      //
  // ================================================================== //
  function hoardings(S, runs) {
    const grp = new THREE.Group(); grp.name = "speedway-hoardings";
    S.root.add(grp);
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      board(S, {
        t0: r.t0, t1: r.t1, closed: !!r.closed, u: r.u,
        y0: r.y0 == null ? 0.05 : r.y0, h: r.h || 1.15, abs: r.abs !== false,
        face: r.face, salt: r.salt == null ? i + 2 : r.salt, vLen: r.vLen || 11,
        thick: 0.14, back: "read", capColor: 0x2d3238,
        parent: grp, name: "hoarding-" + i,
      });
    }
    return grp;
  }

  // ================================================================== //
  //  MARSHAL POSTS + TYRE STACKS + GRAVEL TRAPS                        //
  // ================================================================== //
  function marshalPosts(S, spots) {
    const grp = new THREE.Group(); grp.name = "speedway-marshal-posts";
    S.root.add(grp);
    const steel = cmat(0x8d949c), deck = cmat(0xc8ced5), roofM = cmat(0xc23a36),
      lightM = cmat(0xffd451, { emissive: 0xffd451, ei: 0.7 });
    const flagCols = [0xf2f4f7, 0xf0c419, 0xc23a36, 0x2ba24a, 0x2e5a8a];
    // FOUR COLOURED CARDS HANGING IN MID-AIR IS NOT A FLAG RACK. They floated
    // 0.56 m over the deck with nothing holding them up and nothing to wave
    // them, which is the exact shape of a filler prop. A marshal post shows ONE
    // flag, on a staff socketed into its own deck and canted out over the rail
    // toward the oncoming cars — one intentional object instead of four.
    const staffIM = makeIM(steel, spots.length + 4, { noShadow: true });
    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i];
      const x = sp.x, z = sp.z, a = sp.heading || 0;
      // local +X = -n_hat, i.e. INBOARD, toward the racing surface.
      const ix = Math.cos(a), iz = -Math.sin(a);
      box(grp, cmat(0x6f757d), x, 0.35, z, 3.6, 0.7, 3.0, a);       // platform base
      box(grp, deck, x, 0.75, z, 3.4, 0.16, 2.8, a);
      for (const s of [-1, 1]) {
        box(grp, steel, x + ix * s * 1.5, 1.9, z + iz * s * 1.5, 0.12, 2.3, 0.12, a);
      }
      box(grp, roofM, x, 3.1, z, 3.8, 0.18, 3.2, a);
      box(grp, lightM, x + Math.sin(a) * 1.4, 3.35, z + Math.cos(a) * 1.4, 0.5, 0.32, 0.32, a);
      propKeep(1, 3.19, 3.19);
      // the flag: a real staff off the deck, and the colour on its tip
      pushStrut(staffIM, x + ix * 1.1, 0.83, z + iz * 1.1,
        x + ix * 2.4, 2.70, z + iz * 2.4, 0.07);
      box(grp, cmat(flagCols[i % flagCols.length]),
        x + ix * 2.15, 2.42, z + iz * 2.15, 0.55, 0.42, 0.05, a);
      propKeep(1, 0.83, 0.83); propCut(3);
      S.solidBox(x - 2, x + 2, z - 2, z + 2, 0, 3.3);
    }
    finishIM(grp, staffIM);
    return grp;
  }

  // dense stacks of tyres — the cheap, universal circuit safety furniture
  function tyreStacks(S, stacks) {
    const grp = new THREE.Group(); grp.name = "speedway-tyre-stacks";
    S.root.add(grp);
    let total = 0;
    for (const st of stacks) total += (st.n || 1) * (st.h || 3);
    const im = new THREE.InstancedMesh(tyreGeom(), cmat(0x1b1d20), total + 8);
    im.count = 0; im.castShadow = false; im.receiveShadow = true;
    const bandIM = makeIM(cmat(0xe8edf3), Math.ceil(total / 3) + 8, { noShadow: true });
    for (const st of stacks) {
      const n = st.n || 1, hgt = st.h || 3;
      for (let i = 0; i < n; i++) {
        const px = st.x + (st.dx || 0) * (i - (n - 1) / 2);
        const pz = st.z + (st.dz || 0) * (i - (n - 1) / 2);
        for (let k = 0; k < hgt; k++) {
          if (im.count >= im.instanceMatrix.count) break;
          _Q.identity();
          _V.set(px, 0.18 + k * 0.34, pz); _SC.set(1, 1, 1);
          _M.compose(_V, _Q, _SC);
          im.setMatrixAt(im.count++, _M);
        }
        // a white banding strap over the top of every third stack
        if (i % 3 === 0) {
          pushStrut(bandIM, px - 0.62, 0.20 + (hgt - 1) * 0.34, pz,
            px + 0.62, 0.20 + (hgt - 1) * 0.34, pz, 0.16);
        }
      }
      S.solidBox(st.x - Math.abs((st.dx || 0) * n / 2) - 0.7, st.x + Math.abs((st.dx || 0) * n / 2) + 0.7,
        st.z - Math.abs((st.dz || 0) * n / 2) - 0.7, st.z + Math.abs((st.dz || 0) * n / 2) + 0.7,
        0, 0.34 * hgt);
    }
    if (im.count) { im.instanceMatrix.needsUpdate = true; grp.add(im); }
    finishIM(grp, bandIM);
    return grp;
  }

  // gravel run-off beds, laid flat on the graded infield
  function gravelTraps(S, beds) {
    const grp = new THREE.Group(); grp.name = "speedway-gravel-traps";
    S.root.add(grp);
    const gmat = new THREE.MeshLambertMaterial({ map: gravelTex() });
    for (const b of beds) {
      S.strip([
        { u: b.u0, dy: 0.045, abs: true, uv: 0 },
        { u: b.u1, dy: 0.055, abs: true, uv: 1 },
      ], {
        t0: b.t0, t1: b.t1, closed: false, step: 4.0, parent: grp, vLen: 8,
        mat: gmat, name: "gravel-trap",
      });
    }
    return grp;
  }

  // ================================================================== //
  //  PADDOCK — transporters, hospitality units, fuel bowsers, a        //
  //  helipad and the perimeter fence. This is where a race weekend     //
  //  actually lives.                                                    //
  // ================================================================== //
  function paddock(S, o) {
    const grp = new THREE.Group(); grp.name = "speedway-paddock";
    S.root.add(grp);
    const rng = S.rng;
    const cabM = cmat(0x2c333c), trailerM = cmat(0xe9edf1), wheelM = cmat(0x15181c),
      hospM = cmat(0xd8dde3), roofM = cmat(0x39424c), fenceM = cmat(0x8f969e),
      padM = cmat(0x4b5158), lineM = cmat(0xf0c419);
    const x0 = o.x0, x1 = o.x1, z0 = o.z0, z1 = o.z1;

    const D = z1 - z0;
    // --- team transporters: ONE nose-in row, trailers side by side, with the
    //     working awning between each pair (this is what a real paddock is) ---
    const N = o.trucks || 10;
    for (let i = 0; i < N; i++) {
      const x = x0 + 12 + i * ((x1 - x0 - 58) / Math.max(1, N - 1));
      const z = z0 + D * 0.34;
      // trailer (long axis along Z, nose pointing -Z toward the garages)
      box(grp, trailerM, x, 2.3, z, 3.0, 3.6, 13.0);
      const band = cmat(PANEL_BG[(i * 3) % PANEL_BG.length]);
      box(grp, band, x + 1.55, 2.6, z, 0.08, 1.5, 12.2);
      box(grp, band, x - 1.55, 2.6, z, 0.08, 1.5, 12.2);
      box(grp, cabM, x, 1.9, z - 8.6, 2.9, 2.9, 4.2);
      for (const wz of [-9.0, -4.2, 3.4, 5.6]) {
        for (const wx of [-1.4, 1.4]) box(grp, wheelM, x + wx, 0.55, z + wz, 0.5, 1.1, 1.1);
      }
      // awning off the flank — the team's open-air working bay
      if (i % 2 === 0) {
        box(grp, cmat(0xbfc6cd), x + 3.4, 3.3, z + 1.0, 3.6, 0.12, 9.0);
        for (const oz of [-3.6, 3.6]) box(grp, fenceM, x + 5.0, 1.65, z + 1.0 + oz, 0.1, 3.3, 0.1);
        propKeep(1, 0, 0);
      }
      propKeep(1, 0, 0);
      S.solidBox(x - 1.8, x + 1.8, z - 11, z + 7, 0, 4.0);
    }

    // --- hospitality units along the back edge ---
    const HN = o.units || 6;
    for (let i = 0; i < HN; i++) {
      const x = x0 + 16 + i * ((x1 - x0 - 32) / Math.max(1, HN - 1));
      const z = z1 - D * 0.16;
      box(grp, hospM, x, 1.8, z, 12.0, 3.4, 6.4);
      box(grp, roofM, x, 3.7, z, 12.8, 0.35, 7.2);
      // the sponsor band sat at z - 3.3 against a wall face at z - 3.2: a 5 cm
      // sliver of daylight behind every one of them. Bands are BOLTED ON.
      box(grp, cmat(PANEL_BG[(i * 5 + 1) % PANEL_BG.length]), x, 3.1, z - 3.22, 9.6, 0.9, 0.1);
      box(grp, cmat(0x6f7780), x, 0.22, z - 5.4, 12.0, 0.3, 3.4);
      // SEVEN STICKS IN A ROW, EACH FLOATING 0.35 m, IS NOT A RAILING. Five
      // posts standing on the ground with a rail across them is, and it is one
      // fewer object per unit.
      for (let r = 0; r < 5; r++) box(grp, fenceM, x - 5.0 + r * 2.5, 0.5, z - 7.0, 0.08, 1.0, 0.08);
      box(grp, fenceM, x, 0.97, z - 7.0, 10.16, 0.07, 0.07);
      propKeep(6, 0, 0); propCut(1);
      S.solidBox(x - 6.0, x + 6.0, z - 3.3, z + 3.3, 0, 3.6);
      if (S.label && i === Math.floor(HN / 2)) {
        const lab = S.label("PADDOCK CLUB", { color: "#ffd451" });
        if (lab) { lab.scale.set(11, 2.4, 1); lab.position.set(x, 5.8, z); grp.add(lab); }
      }
    }

    // --- fuel bowsers + generator sets, tucked against the front edge ---
    for (let i = 0; i < 4; i++) {
      const x = x0 + 4.5, z = z0 + D * (0.12 + i * 0.19);
      box(grp, cmat(0xc23a36), x, 1.2, z, 3.0, 2.2, 2.2);
      box(grp, cmat(0x2b3138), x, 0.35, z, 3.2, 0.7, 2.4);
      propKeep(1, 0, 0);
      S.solidBox(x - 1.7, x + 1.7, z - 1.3, z + 1.3, 0, 2.4);
    }

    // --- helipad ---
    const hx = x1 - 22, hz = z0 + D * 0.36;
    const pad = new THREE.Mesh(new THREE.CircleGeometry(9, 32), padM);
    pad.rotation.x = -Math.PI / 2; pad.position.set(hx, 0.05, hz);
    pad.receiveShadow = true; grp.add(pad);
    const ring = new THREE.Mesh(new THREE.RingGeometry(7.2, 8.0, 32), lineM);
    ring.rotation.x = -Math.PI / 2; ring.position.set(hx, 0.08, hz); grp.add(ring);
    box(grp, lineM, hx, 0.08, hz, 1.1, 0.03, 6.2);
    box(grp, lineM, hx, 0.08, hz - 2.6, 4.4, 0.03, 1.1);
    box(grp, lineM, hx, 0.08, hz + 2.6, 4.4, 0.03, 1.1);

    // --- perimeter fence with a gate ---
    // MIGRATED onto the shared site kit (CBZ.venueSite.fence, below). This was
    // three PlaneGeometry meshes + a private post loop whose "gate" was a
    // fraction of a run (0.44..0.56) rather than a place — so moving the
    // paddock entrance meant editing a percentage. The gap is now a world
    // POINT, and the whole perimeter is one merged panel geometry instead of
    // three. Same silhouette, two draw calls, and it is the same code the two
    // venue frontages run.
    fence({
      root: grp, name: "speedway-paddock-fence",
      path: [{ x: x0, z: z1 }, { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }],
      h: 2.4, pitch: 3.0, post: 0x8f969e,
      gaps: [{ x: (x0 + x1) / 2, z: z0, half: (x1 - x0) * 0.06 }],
    });
    return grp;
  }

  // ==================================================================== //
  //  THE SITE KIT — CBZ.venueSite                                        //
  //                                                                       //
  //  OWNER: "the fight arena is not very intentional feeling right now,   //
  //  neither is the racing arena." Both BUILDINGS were already good. What //
  //  neither had was a SITE — the designed arrival that tells you where   //
  //  the venue starts: a perimeter you cross at ONE point, a gate         //
  //  somebody staffs, a sign that names the place BEFORE you reach it,    //
  //  lamps down the approach, and a car park whose painted bays and whose //
  //  parked cars come out of the SAME solve so they can never disagree    //
  //  (the speedway's did: 264 m of painted stalls against ten cars, and   //
  //  those ten never spawned — see island_speedway.js).                   //
  //                                                                       //
  //  WHY IT LIVES IN THIS FILE: the fence / instancing / chain-link       //
  //  machinery it needs was already here. `paddock`'s private `fenceRun`  //
  //  is its FIRST consumer and is deleted in the same change — this is a  //
  //  migration, not a parallel system. Every entry point is a pure draw   //
  //  against numbers the caller already holds: nothing is registered,     //
  //  nothing is mirrored, the caller keeps its own collider ledger (pass  //
  //  `solid`), and every consumer guards with `CBZ.venueSite ? … : skip`  //
  //  so adopting can never break a build.                                 //
  //                                                                       //
  //  DRAW-CALL BUDGET, because a site is a lot of small repeated things:  //
  //  a whole fence (any length) is 2 — one InstancedMesh of posts and ONE //
  //  merged panel geometry. A whole lamp row is 4, whatever its length. A //
  //  monument is 3. A gatehouse is ~16 and is the ONE thing that spends:  //
  //  it is the landmark you arrive AT, and there are two in the world.    //
  //  Emissive goes on lamp lenses and the gate canopy soffit only —       //
  //  never on a fence post.                                               //
  // ==================================================================== //
  //  COLLIDER CONTRACT: every entry point takes `o.solid` and calls it as
  //  solid(minX, minZ, maxX, maxZ, y0, y1) — the (x,z,x,z) order city/ uses
  //  everywhere. island_speedway.js's own solidBox is (minX, maxX, minZ,
  //  maxZ) and therefore adapts; passing it in raw would swap two axes and
  //  silently put every gate and fence collider in the wrong place.
  const SITE_POST = 0x8f969e, SITE_MESH = 0xb9c0c8, SITE_CONC = 0x9aa0aa,
    SITE_DARK = 0x1b1f26, SITE_STEEL = 0x2a2f38;

  // Is this point inside one of the declared openings? A gap is authored in
  // WORLD coordinates ("the road crosses here"), never as a path index, so a
  // caller can move its road without re-counting fence panels.
  //
  // AND — a gap is not really a thing to author at all. A perimeter opens where
  // a ROAD crosses it, and `city.roads` is the registry every road builder in
  // this game already pushes to, so city/roadrules.js's CBZ.roadGapAt answers
  // the same question from data both venues already carry. The declared `gaps`
  // list stays because it is the only thing a venue can use for a crossing that
  // is NOT a road (a footpath, a service yard mouth) and because it is the
  // degrade path when roadrules.js is absent or ROAD_GAP_RUNS is off — but a
  // venue whose fence is built after its own approach record no longer has to
  // remember to declare the hole its road needs. Degrade-safe by construction:
  // `CBZ.roadGapAt` missing => exactly the old answer.
  function inGap(gaps, x, z, noRoad) {
    if (gaps) {
      for (let i = 0; i < gaps.length; i++) {
        const g = gaps[i]; if (!g) continue;
        const h = g.half == null ? 6 : g.half;
        if (Math.abs(x - g.x) <= h && Math.abs(z - g.z) <= h) return true;
      }
    }
    if (noRoad || !CBZ.roadGapAt) return false;
    return !!CBZ.roadGapAt(x, z, 0);
  }

  /* A PERIMETER IS A POLYLINE WITH HOLES IN IT.
       o.root       parent
       o.path       [{x,z}…] (>= 2 points)
       o.closed     close the loop back to path[0]
       o.y          ground height the fence stands on (default 0)
       o.h          fabric height (default 2.4)
       o.pitch      post spacing (default 3.0)
       o.gaps       [{x,z,half}] world-space openings (gate, service road)
       o.noRoadGaps true => do NOT also open where a city.roads carriageway
                    crosses. The default is to open there: a fence across a
                    live road is the bug this whole law exists for, and a
                    perimeter that WANTS to seal a road is a checkpoint, which
                    is a different object.
       o.solid      fn(minX,minZ,maxX,maxZ,y0,y1) — the CALLER's collider ledger
       o.solidYaw   fn(cx,cz,hw,hd,yaw,y0,y1) — the SAME ledger, oriented form.
                    Supply it and a curved perimeter collides as the fence it
                    is; omit it and every piece degrades to its bounding box,
                    which on a curve is metres of invisible wall (see
                    flushRun). Straight runs are identical either way.
       o.colliderPitch  collider length along the run (default 12)
       o.post/o.fabric  colours
     Returns {group, posts, panels, colliders, length, aabbSlackSaved}. */
  function fence(o) {
    if (!o || !o.root || !o.path || o.path.length < 2) return null;
    const grp = new THREE.Group(); grp.name = o.name || "venue-fence";
    o.root.add(grp);
    const y0 = o.y || 0, h = o.h == null ? 2.4 : o.h;
    const pitch = o.pitch || 3.0, cp = o.colliderPitch || 12;
    const pts = o.path.slice(0);
    if (o.closed) pts.push({ x: pts[0].x, z: pts[0].z });
    // panel geometry is merged: ONE draw call for the whole perimeter
    const pos = [], nor = [], uv = [], idx = [];
    let quads = 0, posts = 0, cols = 0, total = 0, slack = 0;
    // Size the post pool off the PATH, not off a round number: an InstancedMesh
    // allocates its whole matrix buffer up front (16 floats an instance), so a
    // blanket 4096 would hand the GPU a megabyte per fence to draw 200 posts.
    let want = 8;
    for (let s0 = 0; s0 + 1 < pts.length; s0++) {
      want += Math.max(1, Math.round(Math.hypot(pts[s0 + 1].x - pts[s0].x, pts[s0 + 1].z - pts[s0].z) / pitch)) + 1;
    }
    const fIM = makeIM(cmat(o.post || SITE_POST), want, { noShadow: true });
    // one contiguous stretch of standing fence, flushed into AABBs on a break
    // THE WORST INVISIBLE WALL IN THE GAME LIVED IN THESE SIX LINES.
    // A run was chopped into `cp`-long pieces and each piece registered as the
    // BOUNDING BOX of its endpoints — fine on the arena's staircase perimeter,
    // where every run is axis-aligned, and a catastrophe on any curve. The
    // speedway's perimeter is a superellipse sampled every 6 deg: measured on
    // the shipped world its 559 m of 0.32 m chain-link became 45 boxes, the
    // worst of them 12.7 m square, holding the player NINE METRES off a fence
    // they could see through. Same run, same pieces — each is now registered
    // with the yaw it actually lies at, so the collider is the fence.
    let runX = null, runZ = null;
    function flushRun(ex, ez) {
      if (runX == null || !o.solid) { runX = null; return; }
      const len = Math.hypot(ex - runX, ez - runZ);
      if (len < 0.5) { runX = null; return; }
      const n = Math.max(1, Math.round(len / cp));
      const oc = o.solidYaw && CBZ.orientedCollider;
      for (let i = 0; i < n; i++) {
        const a = i / n, b = (i + 1) / n;
        const ax = runX + (ex - runX) * a, az = runZ + (ez - runZ) * a;
        const bx = runX + (ex - runX) * b, bz = runZ + (ez - runZ) * b;
        if (oc) {
          // local +x along the run, local +z across it. rotation.y sends local
          // +x to world (cos,-sin), so cos = the run's dx and sin = -dz.
          const yaw = Math.atan2(az - bz, bx - ax);
          const seg = Math.hypot(bx - ax, bz - az);
          if (CBZ.orientedSlack) slack += CBZ.orientedSlack(seg / 2, 0.16, yaw);
          o.solidYaw((ax + bx) / 2, (az + bz) / 2, seg / 2, 0.16, yaw, y0, y0 + h);
        } else {
          o.solid(Math.min(ax, bx) - 0.16, Math.min(az, bz) - 0.16,
                  Math.max(ax, bx) + 0.16, Math.max(az, bz) + 0.16, y0, y0 + h);
        }
        cols++;
      }
      runX = null;
    }
    for (let s = 0; s + 1 < pts.length; s++) {
      const a = pts[s], b = pts[s + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLen < 0.01) continue;
      total += segLen;
      const n = Math.max(1, Math.round(segLen / pitch));
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      const nx = Math.cos(yaw), nz = -Math.sin(yaw);      // panel normal
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const x0 = a.x + (b.x - a.x) * t0, z0 = a.z + (b.z - a.z) * t0;
        const x1 = a.x + (b.x - a.x) * t1, z1 = a.z + (b.z - a.z) * t1;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        if (inGap(o.gaps, mx, mz, o.noRoadGaps)) { flushRun(x0, z0); continue; }
        if (runX == null) { runX = x0; runZ = z0; }
        // post at the leading edge of every panel (+ the closing one below)
        pushStrut(fIM, x0, y0, z0, x0, y0 + h + 0.12, z0, 0.11); posts++;
        const w = Math.hypot(x1 - x0, z1 - z0), tiles = Math.max(1, w / 2.4);
        const px = [x0, x1, x1, x0], pz = [z0, z1, z1, z0];
        const py = [y0 + 0.04, y0 + 0.04, y0 + h, y0 + h];
        const us = [0, tiles, tiles, 0], vs = [0, 0, 1.6, 1.6];
        for (let k = 0; k < 4; k++) {
          pos.push(px[k], py[k], pz[k]); nor.push(nx, 0, nz); uv.push(us[k], vs[k]);
        }
        idx.push(quads * 4, quads * 4 + 1, quads * 4 + 2,
                 quads * 4, quads * 4 + 2, quads * 4 + 3);
        quads++;
        if (i === n - 1) { pushStrut(fIM, x1, y0, z1, x1, y0 + h + 0.12, z1, 0.11); posts++; }
      }
      flushRun(b.x, b.z);
    }
    finishIM(grp, fIM);
    if (quads) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
        map: chainLink(), alphaTest: 0.45, side: THREE.DoubleSide,
        color: o.fabric || SITE_MESH,
      }));
      m.userData.venueFence = true;              // non-empty userData: batch.js spares it
      grp.add(m);
    }
    return { group: grp, posts: posts, panels: quads, colliders: cols, length: total,
             // metres of solid air this perimeter would have added if every
             // piece were still registered as its own bounding box. A RATCHET:
             // it may only go down, and on a curved perimeter it must never
             // read 0 (that would mean the yaw path went dark again).
             aabbSlackSaved: +slack.toFixed(1) };
  }

  /* THE ONE PLACE YOU CROSS THE PERIMETER. Authored in a LOCAL frame where
     +X runs across the opening and +Z points OUTWARD at whoever is arriving,
     so a caller only ever supplies a yaw — the same convention CBZ.lampMast
     uses, and for the same reason (two constants describing one object must
     never be typed independently).
       o.root,o.x,o.z,o.yaw   placement; yaw = atan2(outX, outZ)
       o.half                 half-width of the opening (carriageway half)
       o.h                    portal clear height (default 5.4)
       o.booth                a staffed control booth on the centre island
       o.arms                 two barrier arms, drawn RAISED (traffic passes)
       o.arch                 a beam across the opening carrying the name
       o.title/o.sub          words on the beam
       o.solid                the caller's collider ledger
     Returns {group, boothAt:{x,z,face}, ...} — boothAt is where the steward
     stands, so the caller never has to re-derive it for cityStaffPost. */
  function gatehouse(o) {
    if (!o || !o.root) return null;
    const grp = new THREE.Group(); grp.name = o.name || "venue-gatehouse";
    grp.position.set(o.x, o.y || 0, o.z);
    grp.rotation.y = o.yaw || 0;
    o.root.add(grp);
    const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0);
    // local (lx,lz) -> world. grp yaw rotates +X toward (cos, -sin)… r128's
    // Y rotation maps local (x,z) to (x·c + z·s, -x·s + z·c).
    function wx(lx, lz) { return o.x + lx * c + lz * s; }
    function wz(lx, lz) { return o.z - lx * s + lz * c; }
    function solidLocal(lx, lz, w, d, y0, y1) {
      if (!o.solid) return;
      const ax = Math.abs(c) * w / 2 + Math.abs(s) * d / 2;
      const az = Math.abs(s) * w / 2 + Math.abs(c) * d / 2;
      const X = wx(lx, lz), Z = wz(lx, lz);
      o.solid(X - ax, Z - az, X + ax, Z + az, y0, y1);
    }
    const half = o.half == null ? 10 : o.half, H = o.h == null ? 5.4 : o.h;
    const conc = cmat(o.conc || SITE_CONC), dark = cmat(SITE_DARK),
      steel = cmat(SITE_STEEL), glass = cmat(0x2c3a46),
      warm = cmat(0xffe6a8, { emissive: 0xffd98a, ei: 0.55 });
    // --- piers, one either side of the opening ---
    for (const sgn of [-1, 1]) {
      const px = sgn * (half + 1.3);
      box(grp, conc, px, H / 2, 0, 2.0, H, 2.0);
      box(grp, dark, px, H + 0.22, 0, 2.5, 0.44, 2.5);
      solidLocal(px, 0, 2.0, 2.0, 0, H);
    }
    // --- the beam, and the name on it ---
    if (o.arch !== false) {
      box(grp, conc, 0, H + 0.55, 0, half * 2 + 4.0, 1.1, 1.5);
      box(grp, dark, 0, H + 1.18, 0, half * 2 + 4.6, 0.22, 1.9);
      if (o.title) {
        const W = 1024, Hh = 128, cv = canvas(W, Hh), g2 = cv.getContext("2d");
        g2.fillStyle = css(o.bg == null ? 0x0c0f14 : o.bg); g2.fillRect(0, 0, W, Hh);
        g2.fillStyle = css(o.fg == null ? 0xffd24a : o.fg);
        g2.font = "bold 74px Arial"; g2.textAlign = "center"; g2.textBaseline = "middle";
        g2.fillText(String(o.title).toUpperCase(), W / 2, Hh / 2 + 2);
        const bt = texFrom(cv, false, false);
        for (const face of [1, -1]) {
          const pl = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 + 3.2, 1.0),
            new THREE.MeshBasicMaterial({ map: bt }));
          pl.position.set(0, H + 0.55, face * 0.78);
          pl.rotation.y = face > 0 ? 0 : Math.PI;
          grp.add(pl);
        }
      }
    }
    // --- the booth. `boothX` is a LOCAL-X offset and it is not decoration:
    //     a control island only works where the road's INNER LANE clears it.
    //     CBZ.roadLanes puts lane 0 at medianHalf + laneW/2, so a 1.2 m median
    //     (every highway record in this game) leaves the inner lane 2.4 m off
    //     the axis and a 5 m island would have cars driving through the hut.
    //     Pass boothX = half + 3 on a highway-cross-section gate and the hut
    //     stands outside the kerb where a real one does; pass 0 only when the
    //     approach was authored with a median wide enough to hold it. ---
    let boothAt = null;
    if (o.booth) {
      const bX = o.boothX == null ? 0 : o.boothX, island = Math.abs(bX) < 0.01;
      if (island) box(grp, conc, 0, 0.09, 0, 5.0, 0.18, 4.4);      // kerbed island
      else box(grp, conc, bX, 0.09, 0, 3.6, 0.18, 4.0);            // hut plinth
      box(grp, conc, bX, 1.55, 0, 2.7, 2.9, 2.7);
      box(grp, glass, bX, 2.05, 1.37, 2.4, 1.3, 0.1);              // service window
      box(grp, glass, bX, 2.05, -1.37, 2.4, 1.3, 0.1);
      box(grp, dark, bX, 3.15, 0, 3.3, 0.3, 3.3);                  // roof cap
      box(grp, steel, bX, 3.9, 0, 0.16, 1.5, 0.16);
      box(grp, dark, 0, 4.75, 0, half * 2 + 1.0, 0.28, 5.2);       // canopy over the lanes
      box(grp, warm, 0, 4.58, 0, half * 1.6, 0.10, 3.4);           // canopy soffit light
      solidLocal(bX, 0, 2.9, 2.9, 0, 3.2);
      // Where the steward stands: at the OUTWARD service window (local +Z is
      // the arriving side, which is why the window is drawn there), facing the
      // way the traffic comes from. Handed back so no caller ever has to
      // re-derive a gate's own geometry to put a body in it.
      boothAt = { x: wx(bX, 1.9), z: wz(bX, 1.9), face: (o.yaw || 0) };
    }
    // --- barrier arms, RAISED. A lowered arm with no animation is a wall you
    //     drive through; a raised one is a gate that has already let you in.
    //     Pivots sit AT THE KERB and the arm leans in over the carriageway,
    //     which is both where a real barrier is bolted and the only mounting
    //     that works whether or not there is an island to stand it on. 4.2 m
    //     is capped, not scaled: an arm as long as a six-lane carriageway,
    //     stood up, is taller than the portal beam it hangs under. ---
    if (o.arms) {
      const armL = Math.min(4.2, half * 0.75), TILT = 0.22;    // ~78 deg up
      const ca2 = Math.cos(TILT), sa2 = Math.sin(TILT);
      for (const sgn of [-1, 1]) {
        const bx = sgn * (half - 0.9);
        box(grp, steel, bx, 0.55, 2.2, 0.36, 1.1, 0.36);           // pivot post
        // rotation.z = sgn·TILT sends the free end toward the axis; the centre
        // is walked back by half the arm so the BASE lands on the pivot.
        const arm = new THREE.Mesh(boxGeo(0.16, armL, 0.16), cmat(0xd8dde2));
        arm.position.set(bx - sgn * sa2 * armL / 2, 1.05 + ca2 * armL / 2, 2.2);
        arm.rotation.z = sgn * TILT;
        grp.add(arm);
        const nb = Math.max(2, Math.round(armL / 1.1));
        for (let b2 = 0; b2 < nb; b2++) {
          const along = (b2 + 0.5) * armL / nb;
          box(grp, cmat(0xc23a36), bx - sgn * sa2 * along, 1.05 + ca2 * along,
            2.2, 0.19, armL / nb * 0.5, 0.19, 0, sgn * TILT);
        }
      }
    }
    return { group: grp, boothAt: boothAt, half: half, h: H };
  }

  /* THE SIGN THAT NAMES THE PLACE BEFORE YOU REACH IT. Two plinths and one
     double-sided board — a monument, not a HUD card. */
  function monument(o) {
    if (!o || !o.root) return null;
    const grp = new THREE.Group(); grp.name = o.name || "venue-monument";
    grp.position.set(o.x, o.y || 0, o.z);
    grp.rotation.y = o.yaw || 0;
    o.root.add(grp);
    const W = o.w == null ? 17 : o.w, H = o.h == null ? 4.6 : o.h, LIFT = o.lift == null ? 1.5 : o.lift;
    const conc = cmat(o.conc || SITE_CONC);
    box(grp, conc, 0, 0.3, 0, W + 2.4, 0.6, 2.4);
    for (const sgn of [-1, 1]) box(grp, conc, sgn * (W / 2 + 0.5), (LIFT + H) / 2, 0, 1.1, LIFT + H, 1.4);
    if (o.solid) {
      const c = Math.abs(Math.cos(o.yaw || 0)), s = Math.abs(Math.sin(o.yaw || 0));
      const ax = c * (W / 2 + 1.2) + s * 1.2, az = s * (W / 2 + 1.2) + c * 1.2;
      o.solid(o.x - ax, o.z - az, o.x + ax, o.z + az, o.y || 0, (o.y || 0) + LIFT + H);
    }
    const cw = 1024, ch = Math.round(1024 * H / W), cv = canvas(cw, ch), g2 = cv.getContext("2d");
    g2.fillStyle = css(o.bg == null ? 0x101520 : o.bg); g2.fillRect(0, 0, cw, ch);
    g2.strokeStyle = css(o.accent == null ? 0xd8a020 : o.accent);
    g2.lineWidth = 14; g2.strokeRect(20, 20, cw - 40, ch - 40);
    g2.fillStyle = css(o.fg == null ? 0xffd24a : o.fg);
    g2.font = "bold " + Math.round(ch * 0.34) + "px Arial";
    g2.textAlign = "center"; g2.textBaseline = "middle";
    g2.fillText(String(o.title || "").toUpperCase(), cw / 2, ch * 0.42);
    if (o.sub) {
      g2.fillStyle = css(o.sub2 == null ? 0x9fb0c4 : o.sub2);
      g2.font = "bold " + Math.round(ch * 0.13) + "px Arial";
      g2.fillText(String(o.sub).toUpperCase(), cw / 2, ch * 0.76);
    }
    const tex = texFrom(cv, false, false);
    // TWO PLANES, NOT ONE DoubleSide PLANE. A back face shows its texture
    // MIRRORED — the U axis that ran to your right from the front runs to your
    // left from behind — so a monument you walked past read backwards. The
    // gatehouse beam in this same file already does it the right way (a second
    // plane yawed by PI, whose own +X then lands on the reader's right); the
    // monument is now the second consumer of that pattern rather than the one
    // place it was got wrong.
    const bm = new THREE.MeshBasicMaterial({ map: tex });
    for (const face of [1, -1]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(W, H), bm);
      pl.position.set(0, LIFT + H / 2, face * 0.03);
      pl.rotation.y = face > 0 ? 0 : Math.PI;
      pl.userData.venueSign = true;
      grp.add(pl);
    }
    return { group: grp, tex: tex };
  }

  /* LAMPS DOWN THE APPROACH. Every mast is solved by CBZ.lampMast — the ONE
     pole/arm/head solve in this repo — and the whole row is 4 draw calls no
     matter how many masts, because poles, arms, heads and lenses are each one
     InstancedMesh of struts.
       o.pts   [{x,z,fx,fz}] position + the direction the head must hang over */
  function lampRow(o) {
    if (!o || !o.root || !o.pts || !o.pts.length) return null;
    const grp = new THREE.Group(); grp.name = o.name || "venue-lamps";
    o.root.add(grp);
    const poleH = o.poleH == null ? 6.0 : o.poleH;
    const LM = CBZ.lampMast
      ? CBZ.lampMast({ poleH: poleH, reach: o.reach == null ? 2.0 : o.reach,
                       rise: o.rise == null ? 0.32 : o.rise, poleR: o.poleR == null ? 0.12 : o.poleR })
      : { poleH: poleH, armLen: 2.0, tipY: poleH + 0.32, tipZ: 2.0,
          headY: poleH + 0.22, headZ: 2.0, bulbY: poleH + 0.12, bulbZ: 2.0 };
    const n = o.pts.length;
    const pole = makeIM(cmat(o.color || SITE_STEEL), n, {});
    const arm = makeIM(cmat(o.color || SITE_STEEL), n, {});
    const head = makeIM(cmat(SITE_DARK), n, {});
    const bulb = makeIM(cmat(0xfff2c8, { emissive: 0xffe9a8, ei: 0.9 }), n, { noShadow: true });
    const y0 = o.y || 0;
    for (let i = 0; i < n; i++) {
      const p = o.pts[i];
      const a = Math.atan2(p.fx || 0, p.fz || 1);      // local +Z over the carriageway
      const ca = Math.cos(a), sa = Math.sin(a);
      const tz = LM.tipZ == null ? 2.0 : LM.tipZ, ty = LM.tipY == null ? LM.poleH + 0.32 : LM.tipY;
      const tX = p.x + tz * sa, tZ = p.z + tz * ca;
      const hX = p.x + LM.headZ * sa, hZ = p.z + LM.headZ * ca;
      const bX = p.x + LM.bulbZ * sa, bZ = p.z + LM.bulbZ * ca;
      pushStrut(pole, p.x, y0, p.z, p.x, y0 + LM.poleH, p.z, 0.22);
      pushStrut(arm, p.x, y0 + LM.poleH, p.z, tX, y0 + ty, tZ, 0.15);
      pushStrut(head, hX, y0 + LM.headY - 0.11, hZ, hX, y0 + LM.headY + 0.11, hZ, 0.62);
      pushStrut(bulb, bX, y0 + LM.bulbY - 0.03, bZ, bX, y0 + LM.bulbY + 0.03, bZ, 0.46);
      if (o.solid) o.solid(p.x - 0.22, p.z - 0.22, p.x + 0.22, p.z + 0.22, y0, y0 + LM.poleH);
    }
    finishIM(grp, pole); finishIM(grp, arm); finishIM(grp, head); finishIM(grp, bulb);
    return { group: grp, count: n, mast: LM };
  }

  /* A CAR PARK IS A SOLVE, NOT A TEXTURE AND A SEPARATE CAR LOOP. Both venues
     drew their stalls in one place and spawned their cars in another, which is
     how the speedway ended up with 264 m of painted bays and ten cars — that
     never spawned. `bays` returns the stall CENTRES and the stripe lines from
     ONE layout, so the paint and the metal can never disagree again.
       o.x0,o.z0   min corner of the block
       o.cols      stalls along x
       o.rows      stall rows (2 = one double-loaded aisle)
     Returns {slots:[{x,z,heading,row,col}], stripes:[{x,z0,z1}], w, d}. */
  function bays(o) {
    const sw = o.stallW == null ? 2.7 : o.stallW;
    const sd = o.stallD == null ? 5.2 : o.stallD;
    const ai = o.aisle == null ? 6.3 : o.aisle;
    const cols = Math.max(1, o.cols | 0), rows = Math.max(1, o.rows | 0);
    const slots = [], stripes = [];
    let z = o.z0, d = 0;
    for (let r = 0; r < rows; r++) {
      const z0 = z, z1 = z + sd;
      for (let ccol = 0; ccol < cols; ccol++) {
        slots.push({
          x: o.x0 + (ccol + 0.5) * sw, z: (z0 + z1) / 2,
          // odd rows face the far kerb, even rows face the near one, so a
          // double-loaded aisle reads as two rows nose-to-nose.
          heading: (r % 2) ? 0 : Math.PI, row: r, col: ccol,
        });
      }
      for (let k = 0; k <= cols; k++) stripes.push({ x: o.x0 + k * sw, z0: z0, z1: z1 });
      z = z1 + ((r % 2) ? 0 : ai);
      d = z1 - o.z0;
      if (r % 2 === 0) d += ai;
    }
    return { slots: slots, stripes: stripes, w: cols * sw, d: d,
             stallW: sw, stallD: sd, aisle: ai };
  }

  // ---- the audit registry. Every site pushes ONE census function, so a third
  //      venue costs no edit to CBZ.venueSiteAudit(). (Same shape as
  //      CBZ.heliFleet: the audit never learns a venue's name.)
  const _sites = {};
  function census(id, fn) { if (id && typeof fn === "function") _sites[id] = fn; }

  CBZ.venueSite = {
    fence: fence, gatehouse: gatehouse, monument: monument,
    lampRow: lampRow, bays: bays, census: census, sites: _sites,
  };

  /* ---- CBZ.venueSiteAudit() — THE RATCHET (BLOCK LAW #5) ------------------
     Everything here is read from LIVE state (cityCars / cityStaffPosts /
     city.noSpawn / city.roads), never from a counter a build loop kept, so a
     site that stops building can never keep passing.
       <venue>Parked    real, enterable, PERSISTENT cars standing in the site's
                        own bays. A painted bay with no metal in it is what
                        "reads abandoned" means numerically.
       <venue>Staff     manned posts (a body actually minted / adopted), with
                        `posts` beside it so a site that "fixes" the count by
                        declaring fewer jobs cannot pass.
       <venue>Keepouts  registered no-spawn zones the site owns.
       roadRecords      city.roads records the sites pushed — the arena's is
                        the one that turns a walk-only causeway into an
                        approach traffic and roadPick can both see.
     None of these is pinned yet: MEASURE FIRST (this file has already been
     burned once by a pinned guess — see CLAUDE.md's propUseAudit note). */
  CBZ.venueSiteAudit = function () {
    const out = { sites: {}, parked: 0, staff: 0, posts: 0, keepouts: 0,
                  roadRecords: 0, bays: 0, gates: 0, fencePanels: 0 };
    for (const id in _sites) {
      let r = null;
      try { r = _sites[id](); } catch (e) { r = { error: String(e && e.message || e) }; }
      if (!r) continue;
      out.sites[id] = r;
      out.parked += r.parked | 0; out.staff += r.staff | 0; out.posts += r.posts | 0;
      out.keepouts += r.keepouts | 0; out.roadRecords += r.roadRecords | 0;
      out.bays += r.bays | 0; out.gates += r.gates | 0; out.fencePanels += r.fencePanels | 0;
      const k = String(id).replace(/[^a-z0-9]/gi, "");
      out[k + "Parked"] = r.parked | 0;
      out[k + "Staff"] = r.staff | 0;
      out[k + "Keepouts"] = r.keepouts | 0;
      if (r.hoardingsFlipped != null) out.hoardingsFlipped = (out.hoardingsFlipped | 0) + (r.hoardingsFlipped | 0);
      if (r.propsFloating != null) out.propsFloating = (out.propsFloating | 0) + (r.propsFloating | 0);
    }
    return out;
  };

  // ---- shared counters the two site builders fill through venueSite --------
  // (a live read still beats a counter, so these are only for the numbers a
  //  live read genuinely cannot recover: how much fence was DRAWN.)

  // ------------------------------------------------------------------ //
  //  PUBLIC SURFACE                                                     //
  // ------------------------------------------------------------------ //
  CBZ.speedwayStructures = {
    grandstand: grandstand,
    pitComplex: pitComplex,
    pylon: pylon,
    jumbotron: jumbotron,
    floodlights: floodlights,
    board: board,
    buildReset: buildReset,
    hoardings: hoardings,
    marshalPosts: marshalPosts,
    tyreStacks: tyreStacks,
    gravelTraps: gravelTraps,
    paddock: paddock,
    tex: {
      sponsorBand: sponsorBand,
      chainLink: chainLink,
      gravel: gravelTex,
      screen: screenTex,
      tyre: tyreGeom,
    },
    util: { box: box, makeIM: makeIM, pushStrut: pushStrut, finishIM: finishIM,
            signFace: signFace },
    // the two ratchets. boardAudit re-reads the shipped BUFFERS (see above);
    // propAudit is the campus's own ledger of what it drew and what it refused.
    boardAudit: boardAudit,
    propAudit: function () {
      return { propsKept: PROPS.kept, propsCut: PROPS.cut, propsFloating: PROPS.floating };
    },
  };

  /* CBZ.speedwayBoardAudit() — pin `flipped` at 0. It is a geometric re-test of
     every board face AND every flat sign face actually in the scene, not a
     build-time counter, so a regression anywhere (a new caller, a changed row
     order, a lost uFlip, a DoubleSide quad, a mirrored scale) fails it.
     `boards`/`signs`/`faces` are printed beside it so a "fix" that stops
     drawing signage cannot pass, and `faces` may only ever RISE. */
  CBZ.speedwayBoardAudit = boardAudit;
  CBZ.speedwayPropAudit = CBZ.speedwayStructures.propAudit;
})();
