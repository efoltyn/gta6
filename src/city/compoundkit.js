/* ============================================================
   city/compoundkit.js — THE CITY KIT: what you build on land you own.

   Owner: "real customization of land you own, not a menu of fake
   upgrades." Everything here is a real piece in CBZ.building's catalog:
   it stands on the plot's own build grid (systems/building.js GRIDS), it
   has colliders, bullets and C4 hit it through systems/structdamage.js's
   concrete/brick/steel/fence rows, it saves through basesave.js, and X in
   build mode takes it down again for half its price back.

   WHAT IS HERE
     1. Shared looks: cast concrete panels (formwork tie holes, lift lines,
        rain streaks, the photo concrete blended in when it loads), CMU block,
        dark steel, galvanised steel, chain-link (alphaTest), razor coil,
        burlap, bank straps, a painted helipad. ONE geometry + ONE material
        per kind part, merged per material, so a 60-piece compound is ~150
        draw calls, not 600.
     2. Kinds (city only, def.kit = true: their front, local -z, faces out of
        the edge `rot` names): cwall, bwall, fence, sandbags, gate (2 edges,
        slides), tower (5 m deck + rung ladder + searchlight), floodlight,
        camera (mounts on a wall/fence/gate/tower edge), garage (2x3, roll-up
        door, +2 storage bays), helipad (3x3), stash (cash cage: real
        dollars, visible straps), bunk (2 crew), bench.
        Plus concrete city versions of the Rust structural kinds
        (CATALOG.<kind>.city, picked by building.js on any plot grid).
     3. Ticks: gates (auto-open for you and your people, shut for everyone
        else, collider out while open, back in only when the gap is clear),
        garage doors, and the night lights (three shared materials; no real
        THREE lights: r128 recompiles every shader when the light count moves).
     4. Verbs (city/interactions.js zones, wired lazily): gate open/lock,
        stash, garage "Park it" / "Get a car".
     5. Blueprints ("perimeter", "towers", "lights", "starter") placing REAL
        pieces through CBZ.building.place, charged once, and a section on the
        property panel (CBZ.cityPlots.addPanelSection).
     6. CBZ.compoundKit: the contract API (posts, gates, stash, cameras...).

   Loads right AFTER systems/buildmode.js; everything city/* is looked up
   lazily (interactions, plots, storage load later).
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.building || !CBZ.pieces) return;
  if (CBZ.compoundKit) return;
  const B = CBZ.building;
  const CATALOG = B.CATALOG;
  const CELL = B.CELL, WALL_H = B.WALL_H;
  const g = CBZ.game;
  const BGU = THREE.BufferGeometryUtils;

  /* ================= money (the zillow.js charge() convention) ============ */
  function money(n) { n = Math.round(n || 0); return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US"); }
  function funds() { return (g.cash || 0) + (g.cityBank || 0); }
  function canAfford(amt) { return funds() >= Math.round(amt || 0); }
  function charge(amt) {
    amt = Math.max(0, Math.round(+amt) || 0);
    if (funds() < amt) return false;
    let owe = amt; const fromCash = Math.min(g.cash || 0, owe);
    g.cash = (g.cash || 0) - fromCash; owe -= fromCash;
    if (owe > 0) g.cityBank = (g.cityBank || 0) - owe;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  function pay(amt) {
    amt = Math.max(0, Math.round(+amt) || 0);
    g.cash = (g.cash || 0) + amt;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function commit() { if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} } }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s || 2); else if (CBZ.flashHint) CBZ.flashHint(m, s || 2); }
  function pid() { return CBZ.netPid ? CBZ.netPid() : "solo"; }
  function nowS() { return (g && g.elapsed) || 0; }

  /* ================= geometry helpers ===================================== */
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
  function xf(geo, x, y, z, rx, ry, rz) {
    _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e); _p.set(x || 0, y || 0, z || 0);
    _m4.compose(_p, _q, _s); geo.applyMatrix4(_m4); return geo;
  }
  function box(w, h, d, x, y, z, rx, ry, rz) { return xf(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz); }
  function cyl(rt, rb, h, seg, x, y, z, rx, ry, rz) { return xf(new THREE.CylinderGeometry(rt, rb, h, seg || 8), x, y, z, rx, ry, rz); }
  // a round bar from a to b ([x,y,z] each)
  function rod(r, a, b, seg) {
    _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _dir.length() || 0.001;
    const geo = new THREE.CylinderGeometry(r, r, len, seg || 6);
    _dir.normalize(); _q.setFromUnitVectors(_up, _dir);
    _p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    _m4.compose(_p, _q, _s); geo.applyMatrix4(_m4);
    return geo;
  }
  // a square tube from a to b (steel angle / HSS read)
  function bar(t, a, b) {
    _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _dir.length() || 0.001;
    const geo = new THREE.BoxGeometry(t, len, t);
    _dir.normalize(); _q.setFromUnitVectors(_up, _dir);
    _p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    _m4.compose(_p, _q, _s); geo.applyMatrix4(_m4);
    return geo;
  }
  // a lamp cone whose narrow end sits at a and wide end at b
  function coneBetween(a, b, rTop, rBot, seg) {
    _dir.set(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const len = _dir.length() || 0.001;
    const geo = new THREE.CylinderGeometry(rTop, rBot, len, seg || 18, 1, true);
    _dir.normalize(); _q.setFromUnitVectors(_up, _dir);
    _p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    _m4.compose(_p, _q, _s); geo.applyMatrix4(_m4);
    return geo;
  }
  // box-projected UVs in METRES, so every texture tiles at its real size no
  // matter how a part was stretched (tu/tv = metres per texture repeat)
  function worldUV(geo, tu, tv, u0, v0) {
    const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv;
    if (!P || !N || !U) return geo;
    u0 = u0 || 0; v0 = v0 || 0;
    for (let i = 0; i < P.count; i++) {
      const nx = Math.abs(N.getX(i)), ny = Math.abs(N.getY(i)), nz = Math.abs(N.getZ(i));
      let u, v;
      if (ny >= nx && ny >= nz) { u = P.getX(i); v = P.getZ(i); }
      else if (nx >= nz) { u = P.getZ(i); v = P.getY(i); }
      else { u = P.getX(i); v = P.getY(i); }
      U.setXY(i, (u + u0) / tu, (v + v0) / tv);
    }
    U.needsUpdate = true;
    return geo;
  }
  // every part here is an indexed Box/Cylinder/Plane/Torus/Tube geometry
  // (position+normal+uv), which is exactly what mergeBufferGeometries wants
  function merge(list) {
    const clean = list.filter(Boolean);
    let out = clean[0];
    if (clean.length > 1 && BGU && BGU.mergeBufferGeometries) {
      out = BGU.mergeBufferGeometries(clean, false) || clean[0];
      if (out !== clean[0]) for (let i = 0; i < clean.length; i++) clean[i].dispose();
    }
    out._shared = true; // pieces.js teardown never disposes a shared kind geometry
    out.computeBoundingSphere();
    return out;
  }
  // deterministic 0..1 (never Math.random in a build path)
  function det(i, m) { return ((i * 1103515 + (m || 7) * 12345) % 977) / 977; }

  /* ================= textures (canvas, lazy, one each) ==================== */
  const TEX = {};
  function aniso() {
    try { return Math.min(8, (CBZ.renderer && CBZ.renderer.capabilities.getMaxAnisotropy()) || 4); } catch (e) { return 4; }
  }
  function canvasTex(key, w, h, paint, repeat) {
    if (TEX[key]) return TEX[key];
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    paint(c.getContext("2d"), w, h, null);
    const t = new THREE.CanvasTexture(c);
    if (repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso();
    t._canvas = c; t._paint = paint;
    TEX[key] = t;
    return t;
  }
  function speckle(x, w, h, n, dark, light) {
    for (let i = 0; i < n; i++) {
      const px = (i * 73 + ((i * i) % 131)) % w, py = (i * 151 + ((i * 7) % 97)) % h, r = det(i, 3);
      x.fillStyle = r < 0.5 ? "rgba(" + dark + "," + (0.08 + r * 0.25).toFixed(3) + ")" : "rgba(" + light + "," + ((r - 0.5) * 0.3).toFixed(3) + ")";
      x.fillRect(px, py, 1 + (i % 3 === 0 ? 1 : 0), 1);
    }
  }
  // CAST CONCRETE PANEL: one texture = one 3 m precast section (u) x 3 m (v)
  function paintPanel(x, w, h, photo) {
    x.fillStyle = "#b9b4aa"; x.fillRect(0, 0, w, h);
    if (photo) { x.globalAlpha = 0.9; x.drawImage(photo, 0, 0, w, h); x.globalAlpha = 1; x.fillStyle = "rgba(196,190,178,0.38)"; x.fillRect(0, 0, w, h); }
    // mottled cure blotches
    for (let i = 0; i < 26; i++) {
      const cx = det(i, 11) * w, cy = det(i, 29) * h, r = 12 + det(i, 5) * 40;
      const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      const dark = det(i, 17) < 0.55;
      gr.addColorStop(0, dark ? "rgba(90,86,78,0.12)" : "rgba(235,230,220,0.10)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = gr; x.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    speckle(x, w, h, 2600, "60,58,54", "255,252,245");
    // rain streaks down from the coping
    for (let k = 0; k < 16; k++) {
      const sx = ((k * 37 + 11) % w), len = 50 + det(k, 13) * 150, sw = 1 + (k % 3);
      const gr = x.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, "rgba(58,55,50,0.24)"); gr.addColorStop(1, "rgba(58,55,50,0)");
      x.fillStyle = gr; x.fillRect(sx, 0, sw, len);
    }
    // formwork lift lines
    for (const ly of [Math.round(h / 3), Math.round(2 * h / 3)]) {
      x.fillStyle = "rgba(80,76,70,0.30)"; x.fillRect(0, ly, w, 1);
      x.fillStyle = "rgba(255,255,255,0.10)"; x.fillRect(0, ly + 1, w, 1);
    }
    // tie holes: 3 x 3, each a dark cone with a lit lower lip
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      const cx = (a + 0.5) * w / 3, cy = (b + 0.5) * h / 3, r = Math.max(2, w / 90);
      const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r * 1.6);
      gr.addColorStop(0, "rgba(28,26,24,0.85)"); gr.addColorStop(0.6, "rgba(50,48,44,0.5)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, r * 1.6, 0, Math.PI * 2); x.fill();
      x.fillStyle = "rgba(255,255,255,0.12)"; x.fillRect(cx - r, cy + r, r * 2, 1);
    }
    // splash-back grime at the foot
    const gb = x.createLinearGradient(0, h * 0.78, 0, h);
    gb.addColorStop(0, "rgba(72,62,48,0)"); gb.addColorStop(1, "rgba(72,62,48,0.34)");
    x.fillStyle = gb; x.fillRect(0, h * 0.78, w, h * 0.22);
    // panel joints (chamfered edges) left/right, cap shadow on top
    x.fillStyle = "rgba(52,50,46,0.55)"; x.fillRect(0, 0, 3, h); x.fillRect(w - 3, 0, 3, h);
    x.fillStyle = "rgba(255,255,255,0.14)"; x.fillRect(3, 0, 1, h);
    x.fillStyle = "rgba(40,38,34,0.35)"; x.fillRect(0, 0, w, 3);
  }
  function paintPlain(x, w, h, photo) {
    x.fillStyle = "#b3aea4"; x.fillRect(0, 0, w, h);
    if (photo) { x.globalAlpha = 0.85; x.drawImage(photo, 0, 0, w, h); x.globalAlpha = 1; x.fillStyle = "rgba(186,180,170,0.30)"; x.fillRect(0, 0, w, h); }
    for (let i = 0; i < 18; i++) {
      const cx = det(i, 41) * w, cy = det(i, 43) * h, r = 10 + det(i, 7) * 34;
      const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, det(i, 3) < 0.5 ? "rgba(92,88,80,0.12)" : "rgba(240,236,228,0.08)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = gr; x.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    speckle(x, w, h, 2200, "58,56,52", "255,252,245");
  }
  function paintCMU(x, w, h) {
    // 0.4 x 0.2 m blocks, running bond: the texture is 1.6 m square
    x.fillStyle = "#a7a39b"; x.fillRect(0, 0, w, h);
    const rows = 8, cols = 4, rh = h / rows, cw = w / cols;
    for (let r = 0; r < rows; r++) for (let c = -1; c < cols; c++) {
      const off = (r % 2) ? cw / 2 : 0, bx0 = c * cw + off, i = r * 7 + c + 3;
      const t = det(i, 19);
      x.fillStyle = "rgb(" + (160 + t * 22 | 0) + "," + (156 + t * 21 | 0) + "," + (148 + t * 20 | 0) + ")";
      x.fillRect(bx0 + 2, r * rh + 2, cw - 4, rh - 4);
    }
    speckle(x, w, h, 1800, "70,68,62", "250,248,240");
    x.fillStyle = "rgba(120,116,108,0.9)";
    for (let r = 0; r <= rows; r++) x.fillRect(0, r * rh - 1, w, 2);
  }
  function paintChain(x, w, h) {
    x.clearRect(0, 0, w, h);
    x.strokeStyle = "rgba(205,210,214,1)"; x.lineWidth = 3;
    const s = w / 4;
    for (let k = -4; k <= 8; k++) {
      x.beginPath(); x.moveTo(k * s, 0); x.lineTo(k * s + h, h); x.stroke();
      x.beginPath(); x.moveTo(k * s, h); x.lineTo(k * s + h, 0); x.stroke();
    }
  }
  function paintSack(x, w, h) {
    x.fillStyle = "#b19c74"; x.fillRect(0, 0, w, h);
    for (let yy = 0; yy < h; yy += 2) { x.fillStyle = (yy % 4) ? "rgba(90,74,48,0.16)" : "rgba(255,240,210,0.08)"; x.fillRect(0, yy, w, 1); }
    for (let xx = 0; xx < w; xx += 3) { x.fillStyle = "rgba(80,66,40,0.12)"; x.fillRect(xx, 0, 1, h); }
    speckle(x, w, h, 500, "60,48,30", "250,235,200");
  }
  function paintBill(x, w, h) {
    x.fillStyle = "#7d9476"; x.fillRect(0, 0, w, h);
    for (let yy = 0; yy < h; yy += 2) { x.fillStyle = (yy % 4) ? "rgba(40,60,40,0.25)" : "rgba(230,240,220,0.18)"; x.fillRect(0, yy, w, 1); }
    x.fillStyle = "#d9cfa8"; x.fillRect(w * 0.42, 0, w * 0.16, h);          // the bank strap
    x.fillStyle = "rgba(140,110,60,0.6)"; x.fillRect(w * 0.42, 0, 1, h); x.fillRect(w * 0.58, 0, 1, h);
  }
  function paintRoll(x, w, h) {
    for (let yy = 0; yy < h; yy++) {
      const t = (Math.sin((yy / h) * Math.PI * 8) + 1) / 2;
      const c = 120 + t * 70 | 0;
      x.fillStyle = "rgb(" + c + "," + (c + 3) + "," + (c + 7) + ")"; x.fillRect(0, yy, w, 1);
    }
    speckle(x, w, h, 300, "60,60,60", "255,255,255");
  }
  function paintPad(x, w, h) {
    x.fillStyle = "#454d49"; x.fillRect(0, 0, w, h);
    speckle(x, w, h, 5000, "30,32,30", "200,205,200");
    x.strokeStyle = "rgba(236,236,228,0.95)";
    // dashed perimeter
    x.lineWidth = w * 0.02; x.setLineDash([w * 0.06, w * 0.04]);
    x.strokeRect(w * 0.035, h * 0.035, w * 0.93, h * 0.93); x.setLineDash([]);
    // touchdown circle
    x.strokeStyle = "rgba(226,186,52,0.95)"; x.lineWidth = w * 0.035;
    x.beginPath(); x.arc(w / 2, h / 2, w * 0.33, 0, Math.PI * 2); x.stroke();
    // the H
    x.fillStyle = "rgba(240,240,232,0.97)";
    const hw = w * 0.2, hh = h * 0.34, st = w * 0.06;
    x.fillRect(w / 2 - hw, h / 2 - hh, st, hh * 2); x.fillRect(w / 2 + hw - st, h / 2 - hh, st, hh * 2);
    x.fillRect(w / 2 - hw, h / 2 - st / 2, hw * 2, st);
    // tyre scuffs
    for (let i = 0; i < 6; i++) { x.fillStyle = "rgba(20,20,20,0.10)"; x.fillRect(w * (0.3 + det(i, 5) * 0.4), h * (0.3 + det(i, 9) * 0.4), w * 0.12, h * 0.02); }
  }
  function paintConeGrad(x, w, h) {
    const gr = x.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.45)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = gr; x.fillRect(0, 0, w, h);
  }
  function paintPool(x, w, h) {
    const gr = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.5, "rgba(255,255,255,0.45)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = gr; x.fillRect(0, 0, w, h);
  }
  // blend the real photo concrete in once it loads (the procedural paint
  // stands in until then, and stays if the file is missing)
  let _photoAsked = false;
  function askPhoto() {
    if (_photoAsked || typeof Image === "undefined") return;
    _photoAsked = true;
    const img = new Image();
    img.onload = function () {
      ["panel", "plain"].forEach(function (k) {
        const t = TEX[k]; if (!t) return;
        const x = t._canvas.getContext("2d");
        t._paint(x, t._canvas.width, t._canvas.height, img);
        t.needsUpdate = true;
      });
    };
    img.src = "assets/textures/concrete512.jpg";
  }

  /* ================= materials (lazy, one per look, never cloned) ========= */
  const MAT = {};
  function shared(m) { m._shared = true; return m; }
  function mat(key) {
    if (MAT[key]) return MAT[key];
    let m;
    switch (key) {
      case "panel": askPhoto(); m = new THREE.MeshLambertMaterial({ color: 0xe6e2da, map: canvasTex("panel", 256, 256, paintPanel) }); break;
      case "plain": askPhoto(); m = new THREE.MeshLambertMaterial({ color: 0xdcd8cf, map: canvasTex("plain", 256, 256, paintPlain) }); break;
      case "trim": askPhoto(); m = new THREE.MeshLambertMaterial({ color: 0xf0ece4, map: canvasTex("plain", 256, 256, paintPlain) }); break;
      case "cmu": m = new THREE.MeshLambertMaterial({ color: 0xffffff, map: canvasTex("cmu", 256, 256, paintCMU) }); break;
      case "steel": m = CBZ.pbrMat ? CBZ.pbrMat(0x30353a, { roughness: 0.42, metalness: 0.55 }) : new THREE.MeshLambertMaterial({ color: 0x30353a }); break;
      case "galv": m = CBZ.pbrMat ? CBZ.pbrMat(0x8e959c, { roughness: 0.48, metalness: 0.5 }) : new THREE.MeshLambertMaterial({ color: 0x8e959c }); break;
      case "wire": m = CBZ.pbrMat ? CBZ.pbrMat(0xb4bbc1, { roughness: 0.3, metalness: 0.75 }) : new THREE.MeshLambertMaterial({ color: 0xb4bbc1 }); break;
      case "chain": m = new THREE.MeshLambertMaterial({ color: 0xc6ccd2, map: canvasTex("chain", 128, 128, paintChain), alphaTest: 0.45, side: THREE.DoubleSide }); break;
      case "sack": m = new THREE.MeshLambertMaterial({ color: 0xffffff, map: canvasTex("sack", 128, 128, paintSack) }); break;
      case "bill": m = new THREE.MeshLambertMaterial({ color: 0xffffff, map: canvasTex("bill", 64, 32, paintBill, false) }); break;
      case "roll": m = new THREE.MeshLambertMaterial({ color: 0xffffff, map: canvasTex("roll", 16, 64, paintRoll) }); break;
      case "pad": m = new THREE.MeshLambertMaterial({ color: 0xffffff, map: canvasTex("pad", 512, 512, paintPad, false), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); break;
      case "hazard": m = CBZ.cmat(0xd8a21c); break;
      case "__brick": m = CBZ.masonryMat ? CBZ.masonryMat("brick_red") : CBZ.cmat(0x8a4a36); break;
      case "black": m = CBZ.cmat(0x17191b); break;
      case "rubber": m = CBZ.cmat(0x1c1d1f); break;
      case "lens": m = CBZ.pbrMat ? CBZ.pbrMat(0x11181e, { roughness: 0.12, metalness: 0.4 }) : CBZ.cmat(0x11181e); break;
      case "mattress": m = CBZ.cmat(0x5d6a78); break;
      case "blanket": m = CBZ.cmat(0x4c5a3e); break;
      case "pillow": m = CBZ.cmat(0xd9d6cc); break;
      case "wood": m = CBZ.cmat(0x7d5c3b); break;
      case "board": m = CBZ.cmat(0x9a8a70); break;
      case "orange": m = CBZ.cmat(0xe0621c); break;
      // --- the night set: animated by the light tick, opted out of damage tint
      case "glow": m = new THREE.MeshBasicMaterial({ color: 0x55564f }); m.userData.noTint = true; break;
      case "padlight": m = new THREE.MeshBasicMaterial({ color: 0x3f5a44 }); m.userData.noTint = true; break;
      case "led": m = new THREE.MeshBasicMaterial({ color: 0xff2a2a }); m.userData.noTint = true; break;
      case "cone":
        m = new THREE.MeshBasicMaterial({ color: 0xfff0c8, map: canvasTex("coneg", 4, 64, paintConeGrad, false), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
        m.userData.noTint = true; m.visible = false; break;
      case "pool":
        m = new THREE.MeshBasicMaterial({ color: 0xfff0c8, map: canvasTex("pool", 64, 64, paintPool, false), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
        m.userData.noTint = true; m.visible = false; break;
      default: m = CBZ.cmat(0xff00ff);
    }
    if (!m._shared) shared(m);
    if (key === "glow" || key === "padlight" || key === "cone" || key === "pool") _lastK = -1; // re-sync the night on the next light tick
    MAT[key] = m;
    return m;
  }

  /* ================= kind shapes: parts cached once per kind ==============
     A shape is {root:[geoFn, matKey], parts:[[geoFn, matKey, opts]...]}.
     realize() builds the geometries the first time a kind is drawn and every
     piece after that is a handful of Mesh objects sharing them. */
  const SHAPES = {};
  const GEOS = {};
  function shapeGeo(kind, idx, fn) {
    const k = kind + "#" + idx;
    return GEOS[k] || (GEOS[k] = fn());
  }
  function realize(kind) {
    const sh = SHAPES[kind];
    const root = new THREE.Mesh(shapeGeo(kind, 0, sh.root[0]), mat(sh.root[1]));
    root.castShadow = sh.root[2] !== false; root.receiveShadow = true;
    for (let i = 0; i < (sh.parts || []).length; i++) {
      const p = sh.parts[i];
      const m = new THREE.Mesh(shapeGeo(kind, i + 1, p[0]), mat(p[1]));
      const o = p[2] || {};
      m.castShadow = !!o.shadow; m.receiveShadow = o.receive !== false;
      if (o.noCull) m.frustumCulled = false;
      if (o.order != null) m.renderOrder = o.order;
      m.updateMatrix(); m.matrixAutoUpdate = false;
      root.add(m);
    }
    return root;
  }

  // ---- local frame helpers (kit convention: local -z = out of the edge) ----
  function alongDir(rot) { return rot === 0 ? { x: 1, z: 0 } : rot === 1 ? { x: 0, z: 1 } : rot === 2 ? { x: -1, z: 0 } : { x: 0, z: -1 }; }
  function outDir(rot) { return B.edgeDir(rot); }
  // local (lx, lz) half-extent box -> building.js collider spec (world offsets)
  function lbox(rot, lx, lz, hx, hz, y0, y1) {
    const a = alongDir(rot), o = outDir(rot);
    const alongIsX = a.x !== 0;
    return { dx: a.x * lx - o.x * lz, dz: a.z * lx - o.z * lz, hx: alongIsX ? hx : hz, hz: alongIsX ? hz : hx, y0: y0, y1: y1 };
  }
  function lpt(piece, lx, lz) {
    const a = alongDir(piece.rot), o = outDir(piece.rot);
    return { x: piece.pos.x + a.x * lx - o.x * lz, z: piece.pos.z + a.z * lx - o.z * lz };
  }

  /* ================= THE KINDS ============================================ */
  const KINDS = {};
  function kind(name, def) {
    def.kind = name; def.kit = true; def.cityOnly = true;
    if (def.solid == null) def.solid = true;
    if (def.walkTop == null) def.walkTop = false;
    if (def.blockLOS == null) def.blockLOS = false;
    if (!def.build) def.build = function () { return realize(name); };
    KINDS[name] = def;
    CATALOG[name] = def;
    return def;
  }

  // ---------- concertina (razor) coil along local x, shared by walls/fences
  function coilGeo(len, y, z, r, turns) {
    const pts = [];
    const N = Math.max(24, turns * 10);
    for (let i = 0; i <= N; i++) {
      const t = i / N, ang = t * turns * Math.PI * 2;
      pts.push(new THREE.Vector3(-len / 2 + t * len + Math.sin(ang * 0.5) * 0.02, y + r + Math.sin(ang) * r, z + Math.cos(ang) * r));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    return new THREE.TubeGeometry(curve, N, 0.009, 3, false);
  }

  // ---------- CONCRETE PERIMETER WALL SECTION (3 m x 3.2 m, precast) -------
  const CW_H = 3.2;
  SHAPES.cwall = {
    root: [function () {   // the cast panel
      return worldUV(merge([box(2.96, 2.86, 0.26, 0, 0.2 + 1.43, 0)]), 3, 3, 1.5, 0);
    }, "panel"],
    parts: [
      [function () {       // plinth, coping, half pilasters at both ends
        return worldUV(merge([
          box(3.0, 0.24, 0.44, 0, 0.12, 0),
          box(3.04, 0.14, 0.42, 0, 3.06 + 0.07, 0),
          box(0.04, 0.02, 0.44, 0, 3.2, 0),
          box(0.2, 3.1, 0.4, -1.4, 1.55, 0), box(0.2, 3.1, 0.4, 1.4, 1.55, 0),
        ]), 2, 2);
      }, "trim", { shadow: true }],
      [function () {       // razor coil on steel brackets
        const parts = [coilGeo(3.0, 3.26, 0, 0.23, 18)];
        for (const bx0 of [-1.1, 0, 1.1]) {
          parts.push(bar(0.04, [bx0, 3.18, 0], [bx0, 3.62, -0.08]));
          parts.push(bar(0.03, [bx0 - 0.12, 3.2, 0], [bx0 + 0.12, 3.2, 0]));
        }
        return merge(parts);
      }, "wire", {}],
    ],
  };
  kind("cwall", {
    label: "Concrete Wall", slot: "edge", support: "ground", tier: "concrete",
    footprint: { hx: CELL / 2, hz: 0.2 }, y0: 0, y1: CW_H, mountY: 3.2,
    hp: 520, price: 1200, blockLOS: true,
  });

  // ---------- BRICK WALL SECTION --------------------------------------------
  SHAPES.bwall = {
    root: [function () { return worldUV(merge([box(2.9, 2.7, 0.3, 0, 0.2 + 1.35, 0)]), 1.6, 0.8, 0.8, 0); }, "__brick"],
    parts: [
      [function () {
        return worldUV(merge([
          box(3.0, 0.2, 0.42, 0, 0.1, 0),
          box(3.04, 0.12, 0.4, 0, 2.96, 0),
          box(0.22, 2.9, 0.42, -1.39, 1.45, 0), box(0.22, 2.9, 0.42, 1.39, 1.45, 0),
          box(0.3, 0.1, 0.46, -1.39, 2.95, 0), box(0.3, 0.1, 0.46, 1.39, 2.95, 0),
        ]), 2, 2);
      }, "trim", { shadow: true }],
    ],
  };
  kind("bwall", {
    label: "Brick Wall", slot: "edge", support: "ground", tier: "brick",
    footprint: { hx: CELL / 2, hz: 0.21 }, y0: 0, y1: 3.02, mountY: 3.02,
    hp: 440, price: 1500, blockLOS: true,
  });

  // ---------- CHAIN-LINK FENCE + outriggers + concertina --------------------
  SHAPES.fence = {
    root: [function () {
      const p = new THREE.PlaneGeometry(2.96, 2.2);
      xf(p, 0, 0.08 + 1.1, 0);
      return worldUV(merge([p]), 0.42, 0.42);
    }, "chain", false],
    parts: [
      [function () {
        const parts = [];
        for (const px of [-1.48, 1.48]) {
          parts.push(cyl(0.045, 0.045, 2.5, 8, px, 1.25, 0));
          parts.push(bar(0.035, [px, 2.45, 0], [px, 2.85, -0.34]));          // outrigger arm, leaning out
          parts.push(cyl(0.05, 0.05, 0.06, 8, px, 2.5, 0));
        }
        parts.push(rod(0.024, [-1.5, 2.34, 0], [1.5, 2.34, 0], 6));          // top rail
        parts.push(rod(0.008, [-1.5, 0.1, 0], [1.5, 0.1, 0], 4));            // tension wire
        for (let k = 0; k < 3; k++) {
          const t = (k + 1) / 3.2;
          parts.push(rod(0.006, [-1.5, 2.45 + 0.4 * t, -0.34 * t], [1.5, 2.45 + 0.4 * t, -0.34 * t], 3)); // barbed strands
        }
        parts.push(box(3.0, 0.12, 0.3, 0, 0.02, 0));                           // mow strip
        return merge(parts);
      }, "galv", { shadow: true }],
      [function () { return merge([coilGeo(3.0, 2.36, -0.05, 0.22, 18)]); }, "wire", {}],
    ],
  };
  kind("fence", {
    label: "Chain Fence", slot: "edge", support: "ground", tier: "fence",
    footprint: { hx: CELL / 2, hz: 0.08 }, y0: 0, y1: 2.9, mountY: 2.4,
    hp: 160, price: 700, blockLOS: false,
  });

  // ---------- SANDBAG POSITION (U of four courses) --------------------------
  SHAPES.sandbags = {
    root: [function () {
      const bags = [];
      let i = 0;
      function course(y, x0, x1, z0, z1, alongX, shift) {
        const L = alongX ? (x1 - x0) : (z1 - z0), n = Math.floor(L / 0.5);
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5 + shift) / n;
          const x = alongX ? x0 + L * Math.min(0.98, t) : x0, z = alongX ? z0 : z0 + L * Math.min(0.98, t);
          const b = new THREE.BoxGeometry(0.52, 0.22, 0.32, 2, 1, 1);
          // pillow the bag: squash the ends
          const P = b.attributes.position;
          for (let v = 0; v < P.count; v++) {
            const lx = P.getX(v), ly = P.getY(v);
            const k2 = 1 - Math.pow(Math.abs(lx) / 0.26, 2) * 0.35;
            P.setY(v, ly * k2); P.setZ(v, P.getZ(v) * (0.85 + 0.15 * k2));
          }
          b.computeVertexNormals();
          xf(b, x, y, z, 0, (alongX ? 0 : Math.PI / 2) + (det(i++, 23) - 0.5) * 0.16, (det(i, 31) - 0.5) * 0.05);
          bags.push(b);
        }
      }
      for (let c = 0; c < 4; c++) {
        const y = 0.11 + c * 0.2, sh = (c % 2) * 0.5 - 0.25;
        course(y, -1.35, 1.35, -1.25, 0, true, sh);          // front, facing out
        course(y, -1.35, 0, -1.0, 0.9, false, sh);            // left arm
        course(y, 1.35, 0, -1.0, 0.9, false, sh);             // right arm
      }
      return worldUV(merge(bags), 0.5, 0.5);
    }, "sack"],
  };
  kind("sandbags", {
    label: "Sandbags", slot: "fill", support: "ground", tier: "brick",
    footprint: { hx: 1.5, hz: 1.5 }, y0: 0, y1: 0.9,
    hp: 300, price: 450, blockLOS: true,
    colliders: function (ctx) {
      return [lbox(ctx.rot, 0, -1.25, 1.45, 0.2, 0, 0.9), lbox(ctx.rot, -1.35, -0.05, 0.18, 1.0, 0, 0.9), lbox(ctx.rot, 1.35, -0.05, 0.18, 1.0, 0, 0.9)];
    },
  });

  // ---------- STEEL SLIDING GATE (spans two edges: 6 m) ---------------------
  const GATE_OPEN_X = -5.75, LEAF_Z = 0.34;
  SHAPES.gate = {
    root: [function () {   // posts, track, keeper, the run-out track behind the wall
      return merge([
        box(0.3, 3.3, 0.3, -2.86, 1.65, 0), box(0.3, 3.3, 0.3, 2.86, 1.65, 0),
        box(0.36, 0.08, 0.36, -2.86, 3.34, 0), box(0.36, 0.08, 0.36, 2.86, 3.34, 0),
        box(11.8, 0.05, 0.12, -2.9, 0.025, LEAF_Z),                         // ground track, opening + run-out
        box(0.16, 0.5, 0.22, 2.74, 1.2, LEAF_Z - 0.02),                      // catch keeper
        box(0.14, 2.9, 0.14, -8.7, 1.45, LEAF_Z + 0.2),                      // run-out guide post
        box(0.4, 0.12, 0.12, -8.7, 2.85, LEAF_Z + 0.1),
      ]);
    }, "steel"],
    parts: [
      [function () { return worldUV(merge([box(6.1, 0.1, 0.9, 0, 0.0, 0.1)]), 2, 2); }, "trim", {}],  // concrete apron under the gate line
    ],
  };
  function gateLeafGeo() {
    return shapeGeo("gate", "leaf", function () {
      const parts = [];
      parts.push(box(5.72, 0.12, 0.1, 0, 0.2, 0));                 // bottom rail
      parts.push(box(5.72, 0.1, 0.1, 0, 2.94, 0));                 // top rail
      parts.push(box(5.72, 0.08, 0.08, 0, 2.02, 0));               // mid rail
      parts.push(box(0.12, 2.86, 0.12, -2.8, 1.57, 0));            // stiles
      parts.push(box(0.12, 2.86, 0.12, 2.8, 1.57, 0));
      parts.push(box(5.6, 1.36, 0.04, 0, 0.94, 0));                // lower sheet
      parts.push(box(5.6, 0.3, 0.04, 0, 1.83, 0));                 // upper sheet, a slot below it
      for (let k = 0; k < 28; k++) parts.push(box(0.035, 0.12, 0.035, -2.7 + k * 0.2, 1.68, 0)); // slot bars
      for (let k = 0; k < 36; k++) parts.push(box(0.03, 0.86, 0.03, -2.72 + k * 0.155, 2.47, 0)); // vertical bars
      for (let k = 0; k < 36; k++) parts.push(xf(new THREE.ConeGeometry(0.035, 0.14, 4), -2.72 + k * 0.155, 3.06, 0)); // spear tips
      for (let k = 0; k < 4; k++) parts.push(box(0.05, 1.3, 0.03, -2.1 + k * 1.4, 0.94, 0.035));  // sheet stiffeners
      for (const wx of [-2.3, 2.3]) parts.push(cyl(0.08, 0.08, 0.06, 12, wx, 0.12, 0, Math.PI / 2, 0, 0)); // rollers
      return merge(parts);
    });
  }
  function gateHazardGeo() {
    return shapeGeo("gate", "hz", function () {
      const parts = [];
      for (let k = 0; k < 4; k++) parts.push(box(0.14, 0.18, 0.05, 2.76, 0.45 + k * 0.4, 0.0));
      return merge(parts);
    });
  }
  const gateDef = kind("gate", {
    label: "Steel Gate", slot: "edge", span: { w: 2 }, support: "ground", tier: "steel",
    footprint: { hx: CELL, hz: 0.25 }, y0: 0, y1: 3.1, mountY: 3.38,
    hp: 640, price: 6500, blockLOS: true,
    colliders: function (ctx) {
      return [
        lbox(ctx.rot, -2.86, 0, 0.16, 0.16, 0, 3.3),
        lbox(ctx.rot, 2.86, 0, 0.16, 0.16, 0, 3.3),
        lbox(ctx.rot, 0, LEAF_Z * 0.5, 2.72, 0.3, 0, 3.1),    // THE LEAF: always last (taken out while open)
      ];
    },
    build: function () {
      const root = realize("gate");
      const leaf = new THREE.Mesh(gateLeafGeo(), mat("steel"));
      leaf.castShadow = true; leaf.receiveShadow = true;
      leaf.position.set(0, 0, LEAF_Z);
      const hz = new THREE.Mesh(gateHazardGeo(), mat("hazard"));
      const coil = new THREE.Mesh(shapeGeo("gate", "coil", function () { return merge([coilGeo(5.7, 3.1, 0, 0.2, 30)]); }), mat("wire"));
      for (const c of [hz, coil]) { c.updateMatrix(); c.matrixAutoUpdate = false; leaf.add(c); }
      leaf.updateMatrix(); leaf.matrixAutoUpdate = false;   // moved by hand (applyGateVisual)
      root.add(leaf);
      root.userData.leaf = leaf;
      return root;
    },
  });

  // ---------- GUARD TOWER ----------------------------------------------------
  const DECK = 5.0, TOWER_TOP = 7.55;
  /* THE WAY UP is a vertical rung ladder off the back edge of the deck,
     through the gap the parapet already leaves there (local x 0.2..1.2): drawn
     by world/ladderkit.js and climbed by systems/climb.js, so the player and a
     crew guard both go up it and come down it hand over hand. It replaces a
     "ship ladder" that was a walkable 57-degree ramp record running 3.2 m off
     the piece's own footprint into the next build cell, which nobody but the
     player could use: the crew guard was teleported onto the deck and back. */
  const TL_X = 0.7, TL_Z = 1.62;          // the rung line, local; the climber hangs on +z (inside the compound)
  function towerLadderSpec() {
    return { x: TL_X, z: TL_Z, nx: 0, nz: 1, y0: 0, y1: DECK };
  }
  SHAPES.tower = {
    root: [function () {   // the cabin parapet (concrete): bullets land here
      return worldUV(merge([
        box(3.1, 1.1, 0.16, 0, DECK + 0.55, -1.47),
        box(0.16, 1.1, 3.1, -1.47, DECK + 0.55, 0), box(0.16, 1.1, 3.1, 1.47, DECK + 0.55, 0),
        box(1.72, 1.1, 0.16, -0.66, DECK + 0.55, 1.47), box(0.3, 1.1, 0.16, 1.35, DECK + 0.55, 1.47),
      ]), 3, 3, 1.5, -DECK);
    }, "panel"],
    parts: [
      [function () {       // deck slab + roof slab
        return worldUV(merge([
          box(3.2, 0.2, 3.2, 0, DECK - 0.1, 0),
          box(3.5, 0.15, 3.5, 0, TOWER_TOP - 0.07, 0),
          box(3.2, 0.05, 3.2, 0, 0.025, 0),
        ]), 2, 2);
      }, "trim", { shadow: true }],
      [function () {       // legs, bracing, cabin posts, stair, rails, searchlight yoke
        const P = [];
        const L = 1.17;   // legs clear the perimeter wall pilasters (inner face 1.3)
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          P.push(box(0.22, DECK - 0.2, 0.22, sx * L, (DECK - 0.2) / 2, sz * L));
          P.push(box(0.46, 0.06, 0.46, sx * L, 0.08, sz * L));              // base plates
          P.push(box(0.1, TOWER_TOP - DECK - 1.1, 0.1, sx * 1.47, DECK + 1.1 + (TOWER_TOP - DECK - 1.1) / 2, sz * 1.47));
        }
        // X bracing on every face, two bays
        for (const f of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          for (const b of [[0.3, 2.4], [2.4, 4.6]]) {
            const a = f[0] !== 0 ? [[f[0] * L, b[0], -L], [f[0] * L, b[1], L]] : [[-L, b[0], f[1] * L], [L, b[1], f[1] * L]];
            const c = f[0] !== 0 ? [[f[0] * L, b[0], L], [f[0] * L, b[1], -L]] : [[L, b[0], f[1] * L], [-L, b[1], f[1] * L]];
            P.push(rod(0.03, a[0], a[1], 5)); P.push(rod(0.03, c[0], c[1], 5));
          }
          P.push(f[0] !== 0 ? box(0.08, 0.1, 2.5, f[0] * L, 2.4, 0) : box(2.5, 0.1, 0.08, 0, 2.4, f[1] * L));
        }
        // the ladder, off the back edge of the deck
        if (CBZ.ladderKit) { const LP = CBZ.ladderKit.parts(towerLadderSpec()); for (let i = 0; i < LP.length; i++) P.push(LP[i]); }
        // top rail around the cabin window band
        P.push(box(3.1, 0.06, 0.06, 0, DECK + 1.12, -1.47));
        P.push(box(0.06, 0.06, 3.1, -1.47, DECK + 1.12, 0)); P.push(box(0.06, 0.06, 3.1, 1.47, DECK + 1.12, 0));
        // searchlight: yoke + drum on the roof, front edge
        P.push(box(0.5, 0.06, 0.5, 0, TOWER_TOP + 0.03, -1.3));
        P.push(box(0.06, 0.45, 0.06, -0.3, TOWER_TOP + 0.26, -1.3)); P.push(box(0.06, 0.45, 0.06, 0.3, TOWER_TOP + 0.26, -1.3));
        P.push(cyl(0.24, 0.27, 0.6, 16, 0, TOWER_TOP + 0.45, -1.3, Math.PI / 2 - 0.35, 0, 0));
        return merge(P);
      }, "steel", { shadow: true }],
      [function () {       // searchlight lens
        return merge([cyl(0.23, 0.23, 0.02, 16, 0, TOWER_TOP + 0.45 - Math.sin(0.35) * 0.31, -1.3 - Math.cos(0.35) * 0.31, Math.PI / 2 - 0.35, 0, 0)]);
      }, "glow", {}],
      [function () {       // searchlight beam, out over the street
        return merge([coneBetween([0, TOWER_TOP + 0.35, -1.62], [0, 0.2, -17], 0.22, 3.4, 20)]);
      }, "cone", { receive: false, noCull: true, order: 5 }],
      [function () {
        const p = new THREE.PlaneGeometry(7.5, 7.5); xf(p, 0, 0.09, -17, -Math.PI / 2, 0, 0); return merge([p]);
      }, "pool", { receive: false, order: 4 }],
    ],
  };
  kind("tower", {
    label: "Guard Tower", slot: "fill", support: "ground", tier: "steel",
    footprint: { hx: 1.5, hz: 1.5 }, y0: 0, y1: TOWER_TOP, mountY: TOWER_TOP + 0.08, deckY: DECK,
    hp: 900, price: 14000, blockLOS: true,
    colliders: function (ctx) {
      const r = ctx.rot, L = 1.17, out = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(lbox(r, sx * L, sz * L, 0.12, 0.12, 0, DECK - 0.2));
      out.push(lbox(r, 0, -1.47, 1.55, 0.09, DECK, DECK + 1.15));
      out.push(lbox(r, -1.47, 0, 0.09, 1.55, DECK, DECK + 1.15));
      out.push(lbox(r, 1.47, 0, 0.09, 1.55, DECK, DECK + 1.15));
      out.push(lbox(r, -0.66, 1.47, 0.86, 0.09, DECK, DECK + 1.15));
      out.push(lbox(r, 1.35, 1.47, 0.15, 0.09, DECK, DECK + 1.15));
      out.push(lbox(r, 0, 0, 1.75, 1.75, TOWER_TOP - 0.15, TOWER_TOP));
      return out;
    },
    onPlace: function (piece) {
      const y = piece.pos.y;
      const deck = { minX: piece.pos.x - 1.55, maxX: piece.pos.x + 1.55, minZ: piece.pos.z - 1.55, maxZ: piece.pos.z + 1.55, top: y + DECK, pieceId: piece.id };
      CBZ.platforms.push(deck); piece.platforms.push(deck);
      // the ladder: the climb record for the steel drawn off the same spec
      towerLadderAdd(piece);
    },
    onRemove: function (piece) { towerLadderDrop(piece); },
  });
  // world-space climb records for the placed towers (the piece's frame: local
  // x along the edge, local -z out of it — lpt())
  const towerLadders = new Map();          // piece -> climb.js ladder
  function towerLadderAdd(piece) {
    towerLadderDrop(piece);
    if (!CBZ.ladderKit) return;
    const o = outDir(piece.rot), y = piece.pos.y;
    const r = lpt(piece, TL_X, TL_Z), top = lpt(piece, TL_X, TL_Z - 0.6), bot = lpt(piece, TL_X, TL_Z + 0.8);
    const L = CBZ.ladderKit.register({
      x: r.x, z: r.z, nx: -o.x, nz: -o.z, y0: y, y1: y + DECK,
      top: top, bottom: bot, name: "guard tower", tag: "compound:tower", mode: "city", meta: { piece: piece },
    });
    if (L) towerLadders.set(piece, L);
  }
  function towerLadderDrop(piece) {
    const L = towerLadders.get(piece);
    if (!L) return;
    towerLadders.delete(piece);
    if (CBZ.climb && CBZ.climb.remove) CBZ.climb.remove(L);
  }

  // ---------- FLOODLIGHT POLE (hugs the edge `rot`, lights the yard) -------
  const FL_H = 6.3;
  SHAPES.floodlight = {
    root: [function () {
      return merge([
        cyl(0.07, 0.1, FL_H, 10, 0, FL_H / 2, 0),
        box(1.3, 0.08, 0.08, 0, FL_H - 0.1, 0.3),
        bar(0.05, [0, FL_H - 0.6, 0], [0, FL_H - 0.12, 0.3]),
        box(0.5, 0.36, 0.14, -0.4, FL_H - 0.28, 0.42, 0.75, 0, 0),
        box(0.5, 0.36, 0.14, 0.4, FL_H - 0.28, 0.42, 0.75, 0, 0),
        box(0.22, 0.4, 0.14, 0, 1.3, 0.1),                                    // ballast box
      ]);
    }, "galv"],
    parts: [
      [function () { return worldUV(merge([box(0.55, 0.3, 0.55, 0, 0.15, 0)]), 1, 1); }, "trim", {}],
      [function () {
        return merge([
          box(0.44, 0.3, 0.02, -0.4, FL_H - 0.33, 0.49, 0.75, 0, 0),
          box(0.44, 0.3, 0.02, 0.4, FL_H - 0.33, 0.49, 0.75, 0, 0),
        ]);
      }, "glow", {}],
      [function () { return merge([coneBetween([0, FL_H - 0.4, 0.62], [0, 0.1, 5.2], 0.35, 3.3, 20)]); }, "cone", { receive: false, noCull: true, order: 5 }],
      [function () { const p = new THREE.PlaneGeometry(9, 9); xf(p, 0, 0.08, 5.0, -Math.PI / 2, 0, 0); return merge([p]); }, "pool", { receive: false, order: 4 }],
    ],
  };
  kind("floodlight", {
    label: "Floodlight", slot: "dep", edgeInset: 0.5, support: "ground", tier: "steel",
    footprint: { hx: 0.3, hz: 0.3 }, y0: 0, y1: FL_H,
    hp: 180, price: 1800,
    colliders: function (ctx) { return [lbox(ctx.rot, 0, 0, 0.28, 0.28, 0, 0.3), lbox(ctx.rot, 0, 0, 0.1, 0.1, 0, FL_H)]; },
  });

  // ---------- CCTV CAMERA (mount slot on a wall/fence/gate/tower edge) ------
  SHAPES.camera = {
    root: [function () {
      return merge([
        box(0.16, 0.2, 0.04, 0, 0.1, 0.02),                                   // wall plate
        bar(0.035, [0, 0.12, 0], [0, 0.34, -0.3]),                            // arm out and up
        box(0.15, 0.14, 0.36, 0, 0.36, -0.42, 0.26, 0, 0),                    // housing
        box(0.2, 0.02, 0.44, 0, 0.45, -0.44, 0.26, 0, 0),                     // sun shield
      ]);
    }, "galv"],
    parts: [
      [function () { return merge([cyl(0.05, 0.05, 0.03, 12, 0, 0.31, -0.6, Math.PI / 2 + 0.26, 0, 0)]); }, "lens", {}],
      [function () { return merge([box(0.02, 0.02, 0.02, 0.05, 0.4, -0.58)]); }, "led", {}],
    ],
  };
  kind("camera", {
    label: "CCTV Camera", slot: "cam", support: "mount", tier: "steel",
    footprint: { hx: 0.12, hz: 0.12 }, y0: 0, y1: 0.5,
    hp: 60, price: 900, solid: false,
  });

  // ---------- GARAGE (2 x 3 cells, roll-up door on the rot side) -----------
  const GA_W = 6, GA_D = 9, GA_H = 3.5, DOOR_W = 4.4, DOOR_H = 2.9, GW = 0.25;
  SHAPES.garage = {
    root: [function () {   // CMU shell
      const hx = GA_W / 2, hz = GA_D / 2;
      return worldUV(merge([
        box(GW, GA_H, GA_D, -hx + GW / 2, GA_H / 2, 0),
        box(GW, GA_H, GA_D, hx - GW / 2, GA_H / 2, 0),
        box(GA_W - 2 * GW, GA_H, GW, 0, GA_H / 2, hz - GW / 2),
        box((GA_W - DOOR_W) / 2, GA_H, GW, -(DOOR_W / 2 + (GA_W - DOOR_W) / 4), GA_H / 2, -hz + GW / 2),
        box((GA_W - DOOR_W) / 2, GA_H, GW, (DOOR_W / 2 + (GA_W - DOOR_W) / 4), GA_H / 2, -hz + GW / 2),
        box(DOOR_W, GA_H - DOOR_H, GW, 0, DOOR_H + (GA_H - DOOR_H) / 2, -hz + GW / 2),
      ]), 1.6, 1.6);
    }, "cmu"],
    parts: [
      [function () {       // roof slab, parapet cap, floor slab, door surround
        const hx = GA_W / 2, hz = GA_D / 2;
        return worldUV(merge([
          box(GA_W + 0.3, 0.22, GA_D + 0.3, 0, GA_H + 0.11, 0),
          box(GA_W + 0.34, 0.3, 0.18, 0, GA_H + 0.37, -hz - 0.06), box(GA_W + 0.34, 0.3, 0.18, 0, GA_H + 0.37, hz + 0.06),
          box(0.18, 0.3, GA_D + 0.3, -hx - 0.06, GA_H + 0.37, 0), box(0.18, 0.3, GA_D + 0.3, hx + 0.06, GA_H + 0.37, 0),
          box(GA_W - 0.1, 0.08, GA_D - 0.1, 0, 0.04, 0),
          box(DOOR_W + 0.3, 0.16, 0.36, 0, DOOR_H + 0.08, -hz + 0.02),
          box(0.16, DOOR_H, 0.36, -DOOR_W / 2 - 0.08, DOOR_H / 2, -hz + 0.02), box(0.16, DOOR_H, 0.36, DOOR_W / 2 + 0.08, DOOR_H / 2, -hz + 0.02),
        ]), 2, 2);
      }, "trim", { shadow: true }],
      [function () {       // door drum + guides + wall pack housing
        const hz = GA_D / 2;
        return merge([
          box(DOOR_W + 0.2, 0.42, 0.42, 0, DOOR_H + 0.22, -hz + GW + 0.24),
          box(0.08, DOOR_H, 0.1, -DOOR_W / 2 - 0.02, DOOR_H / 2, -hz + GW + 0.06), box(0.08, DOOR_H, 0.1, DOOR_W / 2 + 0.02, DOOR_H / 2, -hz + GW + 0.06),
          box(0.36, 0.2, 0.2, 0, DOOR_H + 0.42, -hz - 0.1),
        ]);
      }, "steel", {}],
      [function () {       // ceiling light bars + outside wall pack lens
        const hz = GA_D / 2;
        return merge([
          box(1.4, 0.05, 0.22, 0, GA_H - 0.04, -1.4), box(1.4, 0.05, 0.22, 0, GA_H - 0.04, 1.8),
          box(0.3, 0.02, 0.14, 0, DOOR_H + 0.31, -hz - 0.2),
        ]);
      }, "glow", {}],
      [function () { const p = new THREE.PlaneGeometry(6, 6); xf(p, 0, 0.09, -GA_D / 2 - 2.2, -Math.PI / 2, 0, 0); return merge([p]); }, "pool", { receive: false, order: 4 }],
    ],
  };
  kind("garage", {
    label: "Garage", slot: "fill", span: { w: 2, d: 3 }, support: "ground", tier: "concrete",
    footprint: { hx: GA_W / 2, hz: GA_D / 2 }, y0: 0, y1: GA_H + 0.5,
    hp: 1600, price: 28000, blockLOS: true, bays: 2,
    colliders: function (ctx) {
      const r = ctx.rot, hx = GA_W / 2, hz = GA_D / 2;
      return [
        lbox(r, -hx + GW / 2, 0, GW / 2, hz, 0, GA_H + 0.5),
        lbox(r, hx - GW / 2, 0, GW / 2, hz, 0, GA_H + 0.5),
        lbox(r, 0, hz - GW / 2, hx, GW / 2, 0, GA_H + 0.5),
        lbox(r, -(DOOR_W / 2 + (GA_W - DOOR_W) / 4), -hz + GW / 2, (GA_W - DOOR_W) / 4, GW / 2, 0, GA_H + 0.5),
        lbox(r, (DOOR_W / 2 + (GA_W - DOOR_W) / 4), -hz + GW / 2, (GA_W - DOOR_W) / 4, GW / 2, 0, GA_H + 0.5),
        lbox(r, 0, -hz + GW / 2, DOOR_W / 2, GW / 2, DOOR_H, GA_H + 0.5),
        lbox(r, 0, 0, hx + 0.15, hz + 0.15, GA_H, GA_H + 0.22),
        lbox(r, 0, -hz + GW + 0.06, DOOR_W / 2, 0.08, 0, DOOR_H),        // THE DOOR: always last
      ];
    },
    build: function () {
      const root = realize("garage");
      const geo = shapeGeo("garage", "door", function () {
        const p = new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.05); xf(p, 0, -DOOR_H / 2, 0);
        return worldUV(merge([p]), 4.4, 0.35);
      });
      const door = new THREE.Mesh(geo, mat("roll"));
      door.castShadow = true; door.receiveShadow = true;
      door.position.set(0, DOOR_H, -GA_D / 2 + GW + 0.06);
      door.updateMatrix(); door.matrixAutoUpdate = false;
      root.add(door);
      root.userData.door = door;
      return root;
    },
  });

  // ---------- HELIPAD (3 x 3 cells, raised deck, painted, edge lights) -----
  const HP_S = 8.8, HP_T = 0.38;
  SHAPES.helipad = {
    root: [function () {
      return worldUV(merge([box(HP_S, HP_T, HP_S, 0, HP_T / 2, 0), box(HP_S + 0.2, 0.1, HP_S + 0.2, 0, 0.05, 0)]), 2, 2);
    }, "plain"],
    parts: [
      [function () { const p = new THREE.PlaneGeometry(HP_S - 0.1, HP_S - 0.1); xf(p, 0, HP_T + 0.003, 0, -Math.PI / 2, 0, 0); return merge([p]); }, "pad", {}],
      [function () {
        const P = [], h = HP_S / 2 - 0.12;
        for (let k = 0; k < 4; k++) {
          const t = -h + (k / 3) * 2 * h;
          P.push(box(0.14, 0.08, 0.14, t, HP_T + 0.04, -h), box(0.14, 0.08, 0.14, t, HP_T + 0.04, h));
          if (k > 0 && k < 3) P.push(box(0.14, 0.08, 0.14, -h, HP_T + 0.04, t), box(0.14, 0.08, 0.14, h, HP_T + 0.04, t));
        }
        return merge(P);
      }, "padlight", {}],
      [function () {       // windsock mast + edge kerb
        return merge([
          cyl(0.04, 0.05, 3.2, 8, HP_S / 2 + 0.4, 1.6, HP_S / 2 + 0.4),
          box(0.7, 0.03, 0.03, HP_S / 2 + 0.4 - 0.35, 3.1, HP_S / 2 + 0.4),
        ]);
      }, "galv", {}],
      [function () { return merge([xf(new THREE.CylinderGeometry(0.2, 0.08, 1.1, 10, 1, true), HP_S / 2 + 0.4 - 0.75, 3.05, HP_S / 2 + 0.4, 0, 0, Math.PI / 2 + 0.2)]); }, "orange", {}],
    ],
  };
  kind("helipad", {
    label: "Helipad", slot: "fill", span: { w: 3, d: 3 }, support: "ground", tier: "concrete",
    footprint: { hx: HP_S / 2, hz: HP_S / 2 }, y0: 0, y1: HP_T,
    hp: 2400, price: 45000, solid: false, walkTop: true,
  });

  // ---------- STASH: a steel cash cage, straps grow with the money ---------
  const ST_CAP = 288, ST_UNIT = 10000;
  SHAPES.stash = {
    root: [function () {   // steel frame + shelves + floor
      const P = [];
      for (const sx of [-0.82, 0.82]) for (const sz of [-0.4, 0.4]) P.push(box(0.05, 1.95, 0.05, sx, 0.975, sz));
      for (const y of [0.06, 0.64, 1.24, 1.9]) {
        P.push(box(1.68, 0.03, 0.84, 0, y, 0));
      }
      P.push(box(1.7, 0.05, 0.05, 0, 1.95, -0.4), box(1.7, 0.05, 0.05, 0, 1.95, 0.4));
      P.push(box(0.05, 1.9, 0.05, 0.02, 0.98, -0.42));                 // door hinge stile (front)
      P.push(box(0.1, 0.16, 0.06, 0.72, 1.0, -0.45));                   // lock box
      return merge(P);
    }, "steel"],
    parts: [
      [function () {       // the mesh walls (chain texture, tight)
        const P = [];
        const f = new THREE.PlaneGeometry(1.64, 1.86); xf(f, 0, 0.99, -0.42); P.push(f);
        const bk = new THREE.PlaneGeometry(1.64, 1.86); xf(bk, 0, 0.99, 0.42); P.push(bk);
        const l = new THREE.PlaneGeometry(0.8, 1.86); xf(l, -0.84, 0.99, 0, 0, Math.PI / 2, 0); P.push(l);
        const r = new THREE.PlaneGeometry(0.8, 1.86); xf(r, 0.84, 0.99, 0, 0, Math.PI / 2, 0); P.push(r);
        return worldUV(merge(P), 0.16, 0.16);
      }, "chain", {}],
    ],
  };
  function stackMatrices() {
    // slot k -> shelf, layer, row, col; fills a shelf layer by layer
    const out = [];
    const m = new THREE.Matrix4();
    const shelves = [0.075, 0.655, 1.255];
    for (let s = 0; s < 3; s++) for (let layer = 0; layer < 3; layer++) for (let zr = 0; zr < 4; zr++) for (let c = 0; c < 8; c++) {
      const x = -0.68 + c * 0.195, z = -0.27 + zr * 0.18, y = shelves[s] + 0.03 + layer * 0.058 + 0.028;
      m.makeRotationY((det(out.length, 3) - 0.5) * 0.12);
      m.setPosition(x, y, z);
      out.push(m.clone());
    }
    return out;
  }
  let _stackM = null;
  kind("stash", {
    label: "Cash Cage", slot: "dep", support: "ground", tier: "steel",
    footprint: { hx: 0.86, hz: 0.45 }, y0: 0, y1: 2.0,
    hp: 700, price: 6000,
    build: function () {
      const root = realize("stash");
      const geo = shapeGeo("stash", "brick", function () { return merge([new THREE.BoxGeometry(0.17, 0.055, 0.075)]); });
      const im = new THREE.InstancedMesh(geo, mat("bill"), ST_CAP);
      if (!_stackM) _stackM = stackMatrices();
      for (let i = 0; i < ST_CAP; i++) im.setMatrixAt(i, _stackM[i]);
      im.instanceMatrix.needsUpdate = true;
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = false; im.receiveShadow = true;
      root.add(im);
      root.userData.stacks = im;
      return root;
    },
  });

  // ---------- BUNK BED (two crew) -------------------------------------------
  SHAPES.bunk = {
    root: [function () {
      const P = [];
      for (const sx of [-0.98, 0.98]) for (const sz of [-0.44, 0.44]) P.push(box(0.05, 1.75, 0.05, sx, 0.875, sz));
      for (const y of [0.32, 1.28]) {
        P.push(box(2.0, 0.05, 0.05, 0, y, -0.44), box(2.0, 0.05, 0.05, 0, y, 0.44));
        P.push(box(0.05, 0.05, 0.9, -0.98, y, 0), box(0.05, 0.05, 0.9, 0.98, y, 0));
      }
      P.push(box(0.05, 0.05, 0.9, -0.98, 1.7, 0), box(0.05, 0.05, 0.9, 0.98, 1.7, 0));
      P.push(box(2.0, 0.04, 0.04, 0, 1.55, -0.44));                     // guard rail
      for (let k = 0; k < 4; k++) P.push(box(0.03, 0.03, 0.4, 0.98, 0.5 + k * 0.28, -0.2)); // ladder rungs
      return merge(P);
    }, "steel"],
    parts: [
      [function () { return merge([box(1.9, 0.14, 0.84, 0, 0.42, 0), box(1.9, 0.14, 0.84, 0, 1.38, 0)]); }, "mattress", {}],
      [function () { return merge([box(1.3, 0.05, 0.86, 0.28, 0.51, 0), box(1.3, 0.05, 0.86, 0.28, 1.47, 0)]); }, "blanket", {}],
      [function () { return merge([box(0.42, 0.1, 0.6, -0.68, 0.53, 0), box(0.42, 0.1, 0.6, -0.68, 1.49, 0)]); }, "pillow", {}],
    ],
  };
  kind("bunk", {
    label: "Bunk Bed", slot: "dep", support: "ground", tier: "steel",
    footprint: { hx: 1.02, hz: 0.48 }, y0: 0, y1: 1.8,
    hp: 150, price: 1200,
  });

  // ---------- WORKBENCH -------------------------------------------------------
  SHAPES.bench = {
    root: [function () { return merge([box(1.9, 0.07, 0.8, 0, 0.92, 0.05)]); }, "wood"],
    parts: [
      [function () {
        const P = [];
        for (const sx of [-0.88, 0.88]) for (const sz of [-0.28, 0.38]) P.push(box(0.06, 0.9, 0.06, sx, 0.45, sz));
        P.push(box(1.8, 0.04, 0.7, 0, 0.25, 0.05));
        P.push(box(0.16, 0.12, 0.22, 0.75, 1.02, -0.25));            // vise
        return merge(P);
      }, "steel", {}],
      [function () { return merge([box(1.9, 1.0, 0.04, 0, 1.45, 0.43)]); }, "board", {}],
    ],
  };
  kind("bench", {
    label: "Workbench", slot: "dep", support: "ground", tier: "steel",
    footprint: { hx: 0.95, hz: 0.45 }, y0: 0, y1: 1.95,
    hp: 150, price: 900,
  });

  /* ================= concrete city versions of the Rust kinds ============
     building.js picks CATALOG[kind].city on any plot grid: same kind, same
     slot and support rules, a city look and a city price. Wood stays for
     survival. */
  function cityVariant(k, extra, shape) {
    const base = CATALOG[k];
    if (!base) return;
    SHAPES["city_" + k] = shape;
    const v = Object.assign({}, base, extra);
    v.build = function () { return realize("city_" + k); };
    base.city = v;
  }
  const FT = 0.3, FLT = B.FLOOR_T || 0.25, WT = 0.26;
  cityVariant("foundation", { label: "Concrete Foundation", tier: "concrete", hp: 900, price: 900 },
    { root: [function () { return worldUV(merge([box(CELL, FT, CELL, 0, -FT / 2, 0)]), 2, 2); }, "plain"] });
  cityVariant("wall", { label: "Concrete Wall Panel", tier: "concrete", hp: 520, price: 1100, footprint: { hx: CELL / 2, hz: WT / 2 } },
    { root: [function () { return worldUV(merge([box(CELL, WALL_H, WT, 0, WALL_H / 2, 0)]), 3, 3, 1.5, 0); }, "panel"] });
  cityVariant("floor", { label: "Concrete Floor", tier: "concrete", hp: 600, price: 800 },
    { root: [function () { return worldUV(merge([box(CELL, FLT, CELL, 0, -FLT / 2, 0)]), 2, 2); }, "trim"] });
  cityVariant("roof", { label: "Concrete Roof", tier: "concrete", hp: 600, price: 900 },
    { root: [function () { return worldUV(merge([box(CELL, FLT, CELL, 0, -FLT / 2, 0), box(CELL + 0.2, 0.08, CELL + 0.2, 0, 0.04, 0)]), 2, 2); }, "trim"] });
  cityVariant("stairs", { label: "Concrete Stairs", tier: "concrete", hp: 700, price: 1500 },
    { root: [function () {
      const P = [], n = 10;
      for (let k = 0; k < n; k++) { const h = (k + 1) * WALL_H / n; P.push(box(CELL * 0.9, h, CELL / n, 0, h / 2, -CELL / 2 + (k + 0.5) * CELL / n)); }
      return worldUV(merge(P), 2, 2);
    }, "plain"] });
  cityVariant("doorframe", { label: "Concrete Doorway", tier: "concrete", hp: 520, price: 1000 },
    { root: [function () {
      const gw = B.DOOR_GAP_W, gh = B.DOOR_GAP_H, sw = (CELL - gw) / 2;
      return worldUV(merge([
        box(sw, WALL_H, WT, -(gw / 2 + sw / 2), WALL_H / 2, 0), box(sw, WALL_H, WT, gw / 2 + sw / 2, WALL_H / 2, 0),
        box(gw, WALL_H - gh, WT, 0, gh + (WALL_H - gh) / 2, 0),
      ]), 3, 3, 1.5, 0);
    }, "panel"] });
  if (CATALOG.door) {
    const gw = B.DOOR_GAP_W, gh = B.DOOR_GAP_H;
    cityVariant("door", { label: "Steel Door", tier: "steel", hp: 450, price: 1200 },
      { root: [function () { return merge([box(gw * 0.94, gh * 0.97, 0.07, 0, gh * 0.97 / 2, 0)]); }, "steel"],
        parts: [[function () { return merge([box(0.05, 0.2, 0.08, gw * 0.36, gh * 0.48, 0), box(gw * 0.9, 0.22, 0.075, 0, 0.14, 0)]); }, "galv", {}]] });
  }

  /* ================= per-kind live registries ============================= */
  const live = { gate: new Set(), garage: new Set(), stash: new Set() };
  function track(k) {
    const d = CATALOG[k];
    const prevPlace = d.onPlace, prevRemove = d.onRemove;
    d.onPlace = function (p, o) { if (prevPlace) prevPlace(p, o); live[k].add(p); if (hooksPlace[k]) hooksPlace[k](p, o); };
    d.onRemove = function (p) { if (prevRemove) prevRemove(p); live[k].delete(p); if (hooksRemove[k]) hooksRemove[k](p); };
    d.onReplay = function (p) { if (hooksReplay[k]) hooksReplay[k](p); };
  }
  const hooksPlace = {}, hooksRemove = {}, hooksReplay = {};

  // ---- gate state ----
  function leafCollider(p) { return p.colliders && p.colliders[p.colliders.length - 1]; }
  function setLeafSolid(p, solid) {
    const c = leafCollider(p); if (!c) return;
    const idx = CBZ.colliders.indexOf(c);
    if (solid && idx < 0) CBZ.colliders.push(c);
    else if (!solid && idx >= 0) CBZ.colliders.splice(idx, 1);
    else return;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  function applyGateVisual(p) {
    const leaf = p.meshRef && p.meshRef.userData.leaf;
    if (!leaf) return;
    leaf.position.x = GATE_OPEN_X * p._slide;
    leaf.updateMatrix();
  }
  hooksPlace.gate = function (p) {
    if (p.open == null) p.open = false;
    if (p.locked == null) p.locked = false;
    p._slide = p.open ? 1 : 0; p._want = p.open; p._lastSeen = -1e9; p._manualT = -1e9;
    const leaf = p.meshRef && p.meshRef.userData.leaf;
    if (leaf) {
      leaf.userData.pieceId = p.id;       // bullets chip the leaf too; pieces.js reaps it by this tag
      CBZ.losBlockers.push(leaf);
    }
    applyGateVisual(p);
    setLeafSolid(p, !p.open);
  };
  hooksReplay.gate = function (p) { p._slide = p.open ? 1 : 0; p._want = !!p.open; applyGateVisual(p); setLeafSolid(p, !p.open); };
  hooksRemove.gate = function () {};

  // ---- garage state ----
  function applyGarageVisual(p) {
    const door = p.meshRef && p.meshRef.userData.door;
    if (!door) return;
    const s = Math.max(0.06, 1 - p._slide * 0.94);
    door.scale.y = s; door.updateMatrix();
  }
  hooksPlace.garage = function (p) { p._slide = 0; p._want = false; applyGarageVisual(p); setLeafSolid(p, true); };
  hooksReplay.garage = hooksPlace.garage;

  // ---- stash state ----
  function stashRefresh(p) {
    const im = p.meshRef && p.meshRef.userData.stacks;
    if (!im) return;
    const cash = stashCash(p);
    im.count = Math.min(ST_CAP, Math.ceil(cash / ST_UNIT - 1e-9));
  }
  hooksPlace.stash = function (p) {
    if (!p.contents || typeof p.contents !== "object") p.contents = { cash: 0 };
    if (!(p.contents.cash >= 0)) p.contents.cash = 0;
    if (p.locked == null) p.locked = true;
    stashRefresh(p);
  };
  hooksReplay.stash = function (p) { hooksPlace.stash(p); };
  hooksRemove.stash = function (p) { if (stashPanelPiece === p) closeStash(); };
  track("gate"); track("garage"); track("stash");

  /* ================= plots, grids, ownership ============================== */
  function plotsApi() { return CBZ.cityPlots || null; }
  function plotOf(piece) {
    const P = plotsApi();
    return (P && piece && piece.grid && P.byId) ? P.byId(piece.grid.id) : null;
  }
  function onPlot(piece, plot) { return !!(piece && piece.alive && piece.grid && plot && piece.grid.id === plot.id); }
  function isMine(piece) {
    if (!piece) return false;
    if (plotOf(piece)) return true;
    return piece.ownerId != null && piece.ownerId === pid();
  }
  function kitData(plot) {
    if (!plot) return {};
    plot.data = plot.data || {};
    return plot.data.kit || (plot.data.kit = {});
  }
  // THE grid for a plot: the lead's Plot.grid origin + a ground height every
  // piece on the plot shares (measured once on the pad, then remembered)
  function gridOf(plot) {
    if (!plot || !plot.grid) return null;
    let oy = null;
    CBZ.pieces.forEach(function (p) { if (oy == null && p.alive && p.grid && p.grid.id === plot.id) oy = p.grid.oy; });
    const kd = kitData(plot);
    if (oy == null && typeof kd.oy === "number") oy = kd.oy;
    if (oy == null) {
      const cx = plot.center ? plot.center.x : plot.grid.ox, cz = plot.center ? plot.center.z : plot.grid.oz;
      let y = 0;
      if (CBZ.groundAt) { try { y = CBZ.groundAt(cx, cz, 0.3); } catch (e) { y = 0; } }
      if (!isFinite(y)) y = 0;
      oy = Math.max(-0.5, Math.min(0.6, y));
      kd.oy = oy;
      const P = plotsApi(); if (P && P.save) P.save();
    }
    return { id: plot.id, ox: plot.grid.ox, oz: plot.grid.oz, oy: oy };
  }
  function cellsOf(plot) {
    const r = plot.rect;
    return {
      nI: Math.max(1, Math.floor((r.maxX - r.minX) / CELL + 1e-6)),
      nJ: Math.max(1, Math.floor((r.maxZ - r.minZ) / CELL + 1e-6)),
    };
  }
  function frontRot(plot) {
    const f = plot.front;
    if (!f) return 2;
    if (Math.abs(f.nz) >= Math.abs(f.nx)) return f.nz < 0 ? 0 : 2;
    return f.nx > 0 ? 1 : 3;
  }
  // the cell on edge `rot` at index k along it
  function edgeCell(rot, k, nI, nJ) {
    if (rot === 0) return [k, 0];
    if (rot === 2) return [k, nJ - 1];
    if (rot === 1) return [nI - 1, k];
    return [0, k];
  }
  function edgeLen(rot, nI, nJ) { return (rot === 0 || rot === 2) ? nI : nJ; }
  function piecesOn(plot) {
    const out = [];
    if (!plot) return out;
    CBZ.pieces.forEach(function (p) { if (onPlot(p, plot)) out.push(p); });
    return out;
  }
  function priceOf(kind, grid) {
    const d = B.defFor(kind, grid || { id: "city" });
    return d && d.price ? d.price : 0;
  }

  /* ================= BLUEPRINTS ============================================ */
  function gateIndex(plot, rot, nI, nJ) {
    const g0 = gridOf(plot), f = plot.front, n = edgeLen(rot, nI, nJ);
    if (n < 2) return -1;
    let k = Math.floor(n / 2) - 1;
    if (f && g0) {
      const t = (rot === 0 || rot === 2) ? (f.x - g0.ox) / CELL : (f.z - g0.oz) / CELL;
      if (isFinite(t)) k = Math.round(t - 0.5);
    }
    return Math.max(0, Math.min(n - 2, k));
  }
  function plan(name, plot) {
    const out = [];
    const { nI, nJ } = cellsOf(plot);
    const fr = frontRot(plot);
    const gk = gateIndex(plot, fr, nI, nJ);
    function perimeter() {
      for (let r = 0; r < 4; r++) {
        const n = edgeLen(r, nI, nJ);
        for (let k = 0; k < n; k++) {
          if (r === fr && (k === gk || k === gk + 1)) continue;
          const c = edgeCell(r, k, nI, nJ);
          out.push({ kind: "cwall", gx: c[0], gz: c[1], rot: r });
        }
      }
      if (gk >= 0) { const c = edgeCell(fr, gk, nI, nJ); out.push({ kind: "gate", gx: c[0], gz: c[1], rot: fr }); }
    }
    function towers() {
      out.push({ kind: "tower", gx: 0, gz: 0, rot: 0 });
      out.push({ kind: "tower", gx: nI - 1, gz: 0, rot: 1 });
      out.push({ kind: "tower", gx: nI - 1, gz: nJ - 1, rot: 2 });
      out.push({ kind: "tower", gx: 0, gz: nJ - 1, rot: 3 });
    }
    function lightKs(n) { return n >= 8 ? [2, n - 3] : n >= 4 ? [Math.floor(n / 2)] : []; }
    function lights() {
      for (let r = 0; r < 4; r++) {
        const n = edgeLen(r, nI, nJ);
        const ks = lightKs(n);
        for (const k of ks) {
          if (r === fr && (k === gk || k === gk + 1)) continue;
          const c = edgeCell(r, k, nI, nJ);
          out.push({ kind: "floodlight", gx: c[0], gz: c[1], rot: r });
        }
      }
    }
    function cams() {
      for (const k of [gk - 1, gk + 2]) {
        if (k < 0 || k >= edgeLen(fr, nI, nJ)) continue;
        const c = edgeCell(fr, k, nI, nJ);
        out.push({ kind: "camera", gx: c[0], gz: c[1], rot: fr });
      }
    }
    function yard() {
      const back = (fr + 2) % 4, n = edgeLen(back, nI, nJ), mid = Math.floor(n / 2);
      const cS = edgeCell(back, mid, nI, nJ);
      out.push({ kind: "stash", gx: cS[0], gz: cS[1], rot: fr });
      // two bunks either side of the cage, clear of the floodlight poles
      const lk = lightKs(n);
      let made = 0;
      for (const k of [mid - 2, mid + 1, mid - 3, mid + 2, mid - 1]) {
        if (made >= 2 || k <= 0 || k >= n - 1 || k === mid || lk.indexOf(k) >= 0) continue;
        const c = edgeCell(back, k, nI, nJ);
        out.push({ kind: "bunk", gx: c[0], gz: c[1], rot: fr });
        made++;
      }
    }
    if (name === "perimeter") perimeter();
    else if (name === "towers") towers();
    else if (name === "lights") lights();
    else if (name === "starter") { perimeter(); towers(); lights(); cams(); yard(); }
    return out;
  }
  const BLUEPRINTS = [
    { id: "perimeter", label: "Perimeter wall", sub: "Concrete wall on every lot edge, steel gate on the street side" },
    { id: "towers", label: "Corner towers", sub: "A guard tower in each corner" },
    { id: "lights", label: "Floodlights", sub: "Poles along the walls, on at night" },
    { id: "starter", label: "Starter compound", sub: "Walls, gate, towers, lights, cameras, a cash cage, bunks" },
  ];
  // what a blueprint would still cost here (skips what is already built or blocked)
  function estimate(name, plot) {
    const gr = gridOf(plot); if (!gr) return { cost: 0, count: 0 };
    const items = plan(name, plot);
    let cost = 0, count = 0;
    const plannedEdges = {};
    for (const it of items) {
      if (it.kind === "camera") {
        if (B.occupantAt("camera", it.gx, 0, it.gz, it.rot, gr) != null) continue;
        const holder = B.occupantAt("cwall", it.gx, 0, it.gz, it.rot, gr);
        if (holder == null && !plannedEdges[it.gx + "," + it.gz + "," + it.rot]) continue;
        cost += priceOf("camera", gr); count++; continue;
      }
      const v = B.validate(it.kind, it.gx, 0, it.gz, it.rot, pid(), gr);
      if (!v.ok) continue;
      if (it.kind === "cwall") plannedEdges[it.gx + "," + it.gz + "," + it.rot] = 1;
      cost += priceOf(it.kind, gr); count++;
    }
    return { cost: cost, count: count };
  }
  function blueprint(name, plot) {
    if (!plot) return { ok: false, placed: [], cost: 0, reason: "no plot" };
    const gr = gridOf(plot);
    if (!gr) return { ok: false, placed: [], cost: 0, reason: "no plot grid" };
    const items = plan(name, plot);
    if (!items.length) return { ok: false, placed: [], cost: 0, reason: "unknown blueprint" };
    const placed = [];
    let cost = 0, skipped = 0, broke = false;
    const wallet = funds();
    for (const it of items) {
      const price = priceOf(it.kind, gr);
      if (cost + price > wallet) { broke = true; continue; }
      const piece = B.place(it.kind, it.gx, 0, it.gz, it.rot, { ownerId: pid(), grid: gr });
      if (!piece) { skipped++; continue; }
      placed.push(piece.id);
      cost += price;
    }
    if (cost > 0) { charge(cost); commit(); }
    if (placed.length && CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
    let reason = null;
    if (!placed.length) reason = broke ? "Not enough money" : "Nothing left to build here";
    else if (broke) reason = "Ran out of money partway";
    else if (skipped) reason = skipped + " spots were blocked or already built";
    return { ok: placed.length > 0, placed: placed, cost: cost, reason: reason };
  }

  /* ================= contract API helpers ================================== */
  function stashCash(p) { return (p && p.contents && p.contents.cash > 0) ? Math.floor(p.contents.cash) : 0; }
  function stashDeposit(p, amt) {
    amt = Math.max(0, Math.floor(+amt || 0));
    if (!p || !p.alive || !amt) return 0;
    if (!p.contents) p.contents = { cash: 0 };
    p.contents.cash = stashCash(p) + amt;
    stashRefresh(p);
    commit();
    return amt;
  }
  function stashTake(p, amt) {
    amt = Math.max(0, Math.floor(+amt || 0));
    if (!p || !p.alive) return 0;
    const have = stashCash(p);
    const took = Math.min(have, amt);
    if (!took) return 0;
    p.contents.cash = have - took;
    stashRefresh(p);
    commit();
    return took;
  }
  function faceOf(fx, fz) { return Math.atan2(fx, fz); }
  function post(x, y, z, fx, fz, k, id) { return { x: x, y: y, z: z, face: faceOf(fx, fz), fx: fx, fz: fz, kind: k, pieceId: id || null }; }
  function posts(plot) {
    const out = [];
    if (!plot) return out;
    const gr = gridOf(plot); if (!gr) return out;
    const list = piecesOn(plot);
    const towerCells = {};
    for (const p of list) {
      const o = outDir(p.rot), a = alongDir(p.rot);
      if (p.kind === "gate") {
        for (const s of [-1, 1]) {
          const x = p.pos.x + a.x * s * 3.9 - o.x * 1.6, z = p.pos.z + a.z * s * 3.9 - o.z * 1.6;
          out.push(post(x, p.pos.y, z, o.x, o.z, "gate", p.id));
        }
      } else if (p.kind === "tower") {
        const q = lpt(p, 0, -0.55);
        out.push(post(q.x, p.pos.y + DECK, q.z, o.x, o.z, "tower", p.id));
        towerCells[p.gridPos.gx + "," + p.gridPos.gz] = 1;
      }
    }
    const { nI, nJ } = cellsOf(plot);
    const cx = (gr.ox + (gr.ox + (nI - 1) * CELL)) / 2, cz = (gr.oz + (gr.oz + (nJ - 1) * CELL)) / 2;
    // corners (inside, facing out along the diagonal); a tower there already covers it
    for (const c of [[0, 0], [nI - 1, 0], [nI - 1, nJ - 1], [0, nJ - 1]]) {
      if (towerCells[c[0] + "," + c[1]]) continue;
      const x = gr.ox + c[0] * CELL, z = gr.oz + c[1] * CELL;
      let fx = x - cx, fz = z - cz; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
      out.push(post(x + fx * -0.3, gr.oy, z + fz * -0.3, fx, fz, "corner", null));
    }
    // wall midpoints (not the street side: the gate posts cover it)
    const fr = frontRot(plot);
    for (let r = 0; r < 4; r++) {
      if (r === fr) continue;
      const n = edgeLen(r, nI, nJ), k = Math.floor(n / 2);
      const c = edgeCell(r, k, nI, nJ), o = outDir(r);
      const x = gr.ox + c[0] * CELL, z = gr.oz + c[1] * CELL;
      const holder = B.occupantAt("cwall", c[0], 0, c[1], r, gr);
      out.push(post(x, gr.oy, z, o.x, o.z, "wall", holder));
    }
    return out;
  }
  function gates(plot) { return piecesOn(plot).filter(function (p) { return p.kind === "gate"; }); }
  function gateOpen(p, open) {
    if (!p || !p.alive || p.kind !== "gate") return false;
    p.open = !!open; p._want = !!open; p._manualT = nowS() + 12;
    return p.open;
  }
  function stash(plot) { const l = piecesOn(plot); for (const p of l) if (p.kind === "stash") return p; return null; }
  function bunks(plot) { let n = 0; for (const p of piecesOn(plot)) if (p.kind === "bunk") n++; return n; }
  function cameras(plot) {
    const out = [];
    for (const p of piecesOn(plot)) {
      if (p.kind !== "camera") continue;
      const o = outDir(p.rot);
      out.push({ x: p.pos.x + o.x * 0.62, y: p.pos.y + 0.32, z: p.pos.z + o.z * 0.62, fx: o.x, fz: o.z, range: 28, pieceId: p.id });
    }
    return out;
  }
  function garageBays() {
    let n = 0;
    live.garage.forEach(function (p) { if (p.alive && plotOf(p)) n += (p.defRef && p.defRef.bays) || 2; });
    return n;
  }

  /* ================= TICKS ================================================ */
  const PEDS_R2 = 4.5 * 4.5;
  function isFriend(ped) {
    return !!ped && !ped.dead && (ped.faction === "player" || ped.recruited || ped._compoundCrew);
  }
  // distance from (x,z) to the gate's opening segment (6 m along the edge)
  function gateDist2(p, x, z) {
    const a = alongDir(p.rot);
    const dx = x - p.pos.x, dz = z - p.pos.z;
    let t = dx * a.x + dz * a.z; t = Math.max(-3, Math.min(3, t));
    const ex = dx - a.x * t, ez = dz - a.z * t;
    return ex * ex + ez * ez;
  }
  function inGap(p, x, z, pad) {
    const c = leafCollider(p); if (!c) return false;
    return x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad;
  }
  function playerXZ() {
    const P = CBZ.player; if (!P) return null;
    if (P.driving && P._vehicle && P._vehicle.pos) return P._vehicle.pos;
    return P.pos;
  }
  function gateDecide(p) {
    const now = nowS();
    const P = CBZ.player;
    const pp = playerXZ();
    let want = null;
    if (now < p._manualT) want = p.open;
    else if (p.locked) want = p.open;
    else {
      let friend = false;
      if (pp && isMine(p)) {
        const r = (P && P.driving) ? 16 : 4.8;
        if (gateDist2(p, pp.x, pp.z) < r * r) friend = true;
      }
      if (!friend && CBZ.cityPeds) {
        const peds = CBZ.cityPeds;
        for (let i = 0; i < peds.length; i++) {
          const q = peds[i];
          if (!isFriend(q) || !q.pos) continue;
          if (gateDist2(p, q.pos.x, q.pos.z) < PEDS_R2) { friend = true; break; }
        }
      }
      if (friend) p._lastSeen = now;
      want = (now - p._lastSeen) < 1.6;
      p.open = want;
    }
    // never shut on someone standing in the gap
    if (!want && p._slide > 0) {
      let blocked = false;
      if (pp && inGap(p, pp.x, pp.z, 0.6)) blocked = true;
      if (!blocked && CBZ.cityPeds) {
        const peds = CBZ.cityPeds;
        for (let i = 0; i < peds.length && !blocked; i++) { const q = peds[i]; if (q && !q.dead && q.pos && inGap(p, q.pos.x, q.pos.z, 0.5)) blocked = true; }
      }
      if (!blocked && CBZ.cityCars) {
        const cars = CBZ.cityCars;
        for (let i = 0; i < cars.length && !blocked; i++) { const c = cars[i]; if (c && c.pos && inGap(p, c.pos.x, c.pos.z, 1.8)) blocked = true; }
      }
      if (blocked) want = true;
    }
    p._want = want;
  }
  // world (x,z) -> the piece's local frame (lx along, lz inward-positive)
  function toLocal(p, x, z) {
    const a = alongDir(p.rot), o = outDir(p.rot), dx = x - p.pos.x, dz = z - p.pos.z;
    return { lx: dx * a.x + dz * a.z, lz: -(dx * o.x + dz * o.z) };
  }
  function insideGarage(p, x, z) { const l = toLocal(p, x, z); return Math.abs(l.lx) < GA_W / 2 && Math.abs(l.lz) < GA_D / 2; }
  function garageDecide(p) {
    const pp = playerXZ(), P = CBZ.player;
    let want = false;
    if (pp && isMine(p)) {
      const d = lpt(p, 0, -GA_D / 2);
      const dx = pp.x - d.x, dz = pp.z - d.z, r = (P && P.driving) ? 14 : 7;
      if (dx * dx + dz * dz < r * r) want = true;
      if (insideGarage(p, pp.x, pp.z)) want = true;   // inside: keep it open
    }
    if (!want && p._slide > 0) {
      const c = leafCollider(p);
      if (c && pp && pp.x > c.minX - 1.5 && pp.x < c.maxX + 1.5 && pp.z > c.minZ - 1.5 && pp.z < c.maxZ + 1.5) want = true;
    }
    p._want = want;
  }
  function animate(p, dt, speed, apply) {
    const target = p._want ? 1 : 0;
    if (p._slide === target) return;
    const step = dt * speed;
    p._slide = target > p._slide ? Math.min(1, p._slide + step) : Math.max(0, p._slide - step);
    // collider out the moment it starts opening, back only once fully shut
    if (p._slide > 0.02) setLeafSolid(p, false);
    if (p._slide === 0) setLeafSolid(p, true);
    apply(p);
  }
  let decideAcc = 0, lightAcc = 1;
  const NEAR2 = 90 * 90;
  function tick(dt) {
    if (!g || g.mode !== "city" || g.state !== "playing") return;
    decideAcc += dt; lightAcc += dt;
    const doDecide = decideAcc >= 0.2;
    if (doDecide) decideAcc = 0;
    const P = CBZ.player, pp = playerXZ();
    live.gate.forEach(function (p) {
      if (!p.alive) return;
      if (doDecide) {
        // near the player: 5 Hz. Far away (crew coming home while you are
        // across town): 1 Hz is plenty for a gate and keeps the ped scan cheap.
        const far = pp && ((p.pos.x - pp.x) * (p.pos.x - pp.x) + (p.pos.z - pp.z) * (p.pos.z - pp.z)) > NEAR2;
        p._farT = (p._farT || 0) + 0.2;
        if (!far || p._farT >= 1) { p._farT = 0; gateDecide(p); }
      }
      animate(p, dt, 0.8, applyGateVisual);   // ~1.3 s end to end: quick enough for a car at speed
    });
    live.garage.forEach(function (p) {
      if (!p.alive) return;
      if (doDecide) garageDecide(p);
      animate(p, dt, 0.7, applyGarageVisual);
    });
    if (lightAcc >= 0.25) { lightAcc = 0; lightTick(); }
    if (doDecide && towerLadders.size) towerLadders.forEach(function (L, p) { if (!p.alive) towerLadderDrop(p); });
    void P;
  }
  // THE NIGHT: three shared materials, so every lamp on the map follows one write
  let _lastK = -1;
  const _cOff = new THREE.Color(0x55564f), _cOn = new THREE.Color(0xfff2d2), _pOff = new THREE.Color(0x3f5a44), _pOn = new THREE.Color(0xa6ffb0);
  function lightTick() {
    if (!MAT.glow && !MAT.cone && !MAT.padlight) return;
    const n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    let k = (n - 0.32) / 0.3; k = k < 0 ? 0 : k > 1 ? 1 : k * k * (3 - 2 * k);
    if (Math.abs(k - _lastK) < 0.01) return;
    _lastK = k;
    if (MAT.glow) MAT.glow.color.copy(_cOff).lerp(_cOn, k);
    if (MAT.padlight) MAT.padlight.color.copy(_pOff).lerp(_pOn, k);
    if (MAT.cone) { MAT.cone.opacity = 0.16 * k; MAT.cone.visible = k > 0.02; }
    if (MAT.pool) { MAT.pool.opacity = 0.24 * k; MAT.pool.visible = k > 0.02; }
  }
  CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.GAMEPLAY + 0.37 : 40.37, tick);

  /* ================= VERBS (city/interactions.js zones, lazy) ============= */
  function nearestLive(set, px, pz, maxD) {
    let best = null, bd = maxD * maxD;
    set.forEach(function (p) {
      if (!p.alive) return;
      const dx = p.pos.x - px, dz = p.pos.z - pz, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = p; }
    });
    return best;
  }
  let verbsWired = false;
  function wireVerbs() {
    if (verbsWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    verbsWired = true;
    const I = CBZ.interactions;
    I.registerZone({
      id: "ck-gate", kind: "gate", radius: 5.5,
      find: function (px, pz) {
        let best = null, bd = 5.5 * 5.5;
        live.gate.forEach(function (p) { if (!p.alive) return; const d = gateDist2(p, px, pz); if (d < bd) { bd = d; best = p; } });
        return best;
      },
      options: [
        {
          id: "ck-gate-toggle", slot: "e", prio: 2,
          canShow: function (t) { return isMine(t); },
          label: function (t) { return t._want ? "Close" : "Open"; },
          onSelect: function (t) { gateOpen(t, !t._want); },
        },
        {
          id: "ck-gate-lock", slot: "i", prio: 2,
          canShow: function (t) { return isMine(t); },
          label: function (t) { return t.locked ? "Unlock" : "Lock"; },
          onSelect: function (t) {
            t.locked = !t.locked;
            if (t.locked) { t.open = false; t._want = false; t._manualT = -1e9; }
            note(t.locked ? "Gate locked. It stays shut until you open it." : "Gate unlocked. It opens for you and your crew.", 2);
            commit();
          },
        },
      ],
    });
    I.registerZone({
      id: "ck-stash", kind: "stash", radius: 2.8,
      find: function (px, pz) { return nearestLive(live.stash, px, pz, 2.8); },
      options: [
        {
          id: "ck-stash-open", slot: "e", prio: 2,
          canShow: function (t) { return isMine(t); },   // someone else's cage: a locked status, not a button
          label: function (t) { return "Open " + money(stashCash(t)); },
          onSelect: function (t) { if (!isMine(t)) { note("Locked.", 1.2); return; } openStash(t); },
        },
      ],
    });
    I.registerZone({
      id: "ck-garage", kind: "garage", radius: 9,
      find: function (px, pz, ctx) {
        let best = null, bd = 81;
        live.garage.forEach(function (p) {
          if (!p.alive || !isMine(p)) return;
          const inside = insideGarage(p, px, pz);
          const d0 = lpt(p, 0, -GA_D / 2 - 1.2);
          const dd = (px - d0.x) * (px - d0.x) + (pz - d0.z) * (pz - d0.z);
          const ok = (ctx && ctx.driving) ? (inside || dd < 16) : (dd < 12 || inside);
          if (ok && dd < bd) { bd = dd; best = p; }
        });
        return best;
      },
      options: [
        {
          id: "ck-garage-park", slot: "e", prio: 3,
          canShow: function (t, ctx) { return !!(ctx && ctx.driving) && !(CBZ.player && CBZ.player._aircraft); },
          label: "Park it",
          onSelect: function () { if (CBZ.cityStorage && CBZ.cityStorage.storeVehicle) CBZ.cityStorage.storeVehicle(); },
        },
        {
          id: "ck-garage-get", slot: "e", prio: 3,
          canShow: function (t, ctx) { return !(ctx && ctx.driving); },
          label: "Take out",
          onSelect: function () {
            const S = CBZ.cityStorage;
            if (S && S.openVirtual) S.openVirtual({ id: "compound-garage", name: "Compound Garage", kind: "garage", blurb: "" });
            else if (S && S.open) S.open();
          },
        },
      ],
    });
  }

  /* ================= STASH PANEL =========================================== */
  let stashPanelPiece = null, spEl = null, spBody = null;
  function spMake() {
    if (spEl || typeof document === "undefined" || !document.body) return;
    spEl = document.createElement("div");
    spEl.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9001;" +
      "width:min(380px,92vw);font:14px/1.4 system-ui,Segoe UI,Roboto,sans-serif;color:#eef;" +
      "background:rgba(14,16,20,0.96);border:1px solid rgba(160,190,150,0.35);border-radius:12px;" +
      "padding:14px 16px;display:none;box-shadow:0 18px 60px rgba(0,0,0,0.7);";
    spBody = document.createElement("div");
    spEl.appendChild(spBody);
    spEl.addEventListener("click", function (e) {
      const b = e.target.closest ? e.target.closest("[data-sk]") : null;
      if (!b || !stashPanelPiece) return;
      stashAct(b.getAttribute("data-sk"));
    });
    document.body.appendChild(spEl);
  }
  function stashAct(k) {
    const p = stashPanelPiece; if (!p) return;
    if (k === "close") { closeStash(); return; }
    const onYou = Math.max(0, Math.floor(g.cash || 0));
    if (k.charAt(0) === "d") {
      const amt = k === "dall" ? onYou : Math.min(onYou, +k.slice(1));
      if (amt > 0) { g.cash = onYou - amt; stashDeposit(p, amt); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} } }
    } else if (k.charAt(0) === "t") {
      const amt = k === "tall" ? stashCash(p) : +k.slice(1);
      const took = stashTake(p, amt);
      if (took > 0) { pay(took); if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} } }
    }
    renderStash();
  }
  function btn(k, label, off) {
    return "<span data-sk='" + k + "' style='display:inline-block;cursor:pointer;margin:3px 6px 3px 0;padding:6px 11px;border-radius:7px;" +
      "background:" + (off ? "rgba(255,255,255,0.05);color:#6c7480" : "rgba(126,217,87,0.16);color:#d9f7c8") + ";font:600 12px system-ui'>" + label + "</span>";
  }
  function renderStash() {
    const p = stashPanelPiece; if (!p || !spBody) return;
    const inCage = stashCash(p), onYou = Math.max(0, Math.floor(g.cash || 0));
    let h = "<div style='font:700 16px system-ui;margin-bottom:2px'>Cash cage</div>";
    h += "<div style='font-size:12px;color:#9fb0a0;margin-bottom:10px'>In the cage " + money(inCage) + ". On you " + money(onYou) + ".</div>";
    h += "<div style='font:700 11px system-ui;letter-spacing:1px;color:#9fb6da;margin:4px 0'>PUT IN</div>";
    h += btn("d1000", "$1,000", onYou < 1) + btn("d10000", "$10,000", onYou < 1) + btn("dall", "All of it", onYou < 1);
    h += "<div style='font:700 11px system-ui;letter-spacing:1px;color:#9fb6da;margin:10px 0 4px'>TAKE OUT</div>";
    h += btn("t1000", "$1,000", inCage < 1) + btn("t10000", "$10,000", inCage < 1) + btn("tall", "All of it", inCage < 1);
    h += "<div style='margin-top:12px'>" + btn("close", "Close") + "<span style='font-size:11px;color:#6b7480'>Esc closes</span></div>";
    spBody.innerHTML = h;
  }
  function openStash(p) {
    if (CBZ.cityMenuOpen) return;
    spMake(); if (!spEl) return;
    stashPanelPiece = p;
    CBZ.cityMenuOpen = true;
    renderStash();
    spEl.style.display = "block";
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }
  function closeStash() {
    if (!stashPanelPiece) return;
    stashPanelPiece = null;
    if (spEl) spEl.style.display = "none";
    CBZ.cityMenuOpen = false;
    if (CBZ.requestLock && g.state === "playing") { try { CBZ.requestLock(); } catch (e) {} }
  }
  addEventListener("keydown", function (e) {
    if (stashPanelPiece && (e.key === "Escape" || e.key === "escape")) { e.preventDefault(); closeStash(); }
  });

  /* ================= PROPERTY PANEL SECTION ================================ */
  const _estCache = new Map();
  function cachedEstimate(name, plot) {
    const k = plot.id + "|" + name, now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const c = _estCache.get(k);
    if (c && now - c.t < 1500) return c.v;
    const v = estimate(name, plot);
    _estCache.set(k, { t: now, v: v });
    return v;
  }
  function panelSection(plot) {
    if (!plot) return null;
    const list = piecesOn(plot);
    const rows = [];
    const nb = bunks(plot);
    rows.push({
      text: list.length ? list.length + " pieces built" + (nb ? ", beds for " + (nb * 2) : "") : "Nothing built yet",
      sub: "Build mode (N) while you stand on the lot",
    });
    for (const bp of BLUEPRINTS) {
      const est = cachedEstimate(bp.id, plot);
      rows.push({
        text: bp.label, sub: bp.sub,
        buttons: [{
          label: est.count ? "Build " + money(est.cost) : "Built",
          tone: "ok",
          disabled: !est.count || funds() < 1,   // short of the full price it builds what you can pay for
          onClick: function () {
            const r = blueprint(bp.id, plot);
            _estCache.clear();
            const msg = r.ok ? bp.label + " built for " + money(r.cost) + (r.reason ? ". " + r.reason : "") : (r.reason || "Could not build that");
            note(msg, r.ok ? 3 : 2.4);
            return msg;   // plots.js shows a returned string in the panel
          },
        }],
      });
    }
    return { title: "Compound", rows: rows };
  }
  let panelWired = false;
  function wirePanel() {
    if (panelWired) return;
    const P = plotsApi();
    if (!P || !P.addPanelSection) return;
    panelWired = true;
    P.addPanelSection(panelSection);
  }
  CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.LATE + 1.3 : 91.3, function () { if (!verbsWired) wireVerbs(); if (!panelWired) wirePanel(); });

  /* ================= build-mode catalogue ================================= */
  const CATEGORIES = [
    { name: "Walls", kinds: ["cwall", "bwall", "fence"] },
    { name: "Gates", kinds: ["gate", "door"] },
    { name: "Defense", kinds: ["tower", "floodlight", "camera", "sandbags"] },
    { name: "Buildings", kinds: ["garage", "helipad", "stash", "bunk", "bench"] },
    { name: "Structure", kinds: ["foundation", "wall", "floor", "roof", "stairs", "doorframe"] },
  ].map(function (c) { return { name: c.name, kinds: c.kinds.filter(function (k) { return !!CATALOG[k]; }) }; });
  function plotAt(x, z, pad) {
    const P = plotsApi();
    return (P && P.at) ? P.at(x, z, pad || 0) : null;
  }
  // X in build mode: half the price back for your own city piece
  function refund(piece) {
    const d = piece && (piece.defRef || CATALOG[piece.kind]);
    if (!d || !d.price || !piece.grid) return 0;
    const amt = Math.round(d.price * 0.5);
    if (amt > 0) { pay(amt); commit(); }
    return amt;
  }

  CBZ.compoundKit = {
    kinds: Object.keys(KINDS),
    categories: CATEGORIES,
    blueprints: BLUEPRINTS.map(function (b) { return b.id; }),
    blueprint: blueprint,
    plan: plan,
    estimate: estimate,
    piecesOn: piecesOn,
    posts: posts,
    gates: gates,
    gateOpen: gateOpen,
    stash: stash,
    stashCash: stashCash,
    stashDeposit: stashDeposit,
    stashTake: stashTake,
    bunks: bunks,
    cameras: cameras,
    garageBays: garageBays,
    gridOf: gridOf,
    plotAt: plotAt,
    plotOf: plotOf,
    priceOf: priceOf,
    refund: refund,
    charge: charge,
    canAfford: canAfford,
    money: money,
    isMine: isMine,
    DECK: DECK,
    _tick: tick,
  };
})();
