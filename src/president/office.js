/* ============================================================
   president/office.js — THE OVAL OFFICE: ONE ROOM, THE WHOLE GAME.

   You sit behind the desk. Everything you can do is something in this room:
     the papers on the desk   Treasury, Commerce, Cabinet & Polls, a bill in
                              its folder when Congress sends one: tap one and
                              you pick it up and read it; the boxes on it are
                              the decisions
     the phone                Holler, calls (foreign leaders ring it), texts
     the map table            the world, openfront style; tap it and you stand
                              over it; tap a country, then what to do to it
     the people               your General, Treasury Secretary, central bank
                              governor, Trade Representative and Security
                              Chief stand in the room with two agents. When one
                              of them has something for you he walks to the
                              desk and says it, and your answer is the three-
                              answer prompt (city/campaign_ui.js). Tap one to
                              hear where he stands, or to fire him.

   The bodies are the engine's (CBZ.studio.cast: the shipped rig, its gait,
   its hands); speech is over the speaker's head (CBZ.speech); a gun drawn in
   this room is the real sidearm on the real hand (systems/actorweapons.js),
   its shot is gunfx's muzzle flash and tracer, and a man who goes down goes
   down through city/ragdoll.js.

   Cheap on purpose: one room of merged boxes, Lambert materials, no shadow
   maps, seven people. It must run on a phone.

   PUBLIC  CBZ.presOffice = { init(opts), update(dt), deliver(matter), ring(matter),
     scene(kind, matter), outcome(ev), focus(kind), back(), mode(), people,
     redraw(kind?), flagColor(hex) }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  const THREE = window.THREE;
  if (!THREE) return;
  const OF = CBZ.presOffice = {};

  // ---------------------------------------------------------------- layout
  const RX = 5.4, RZ = 4.4, WALL_H = 3.6;
  const DESK = { x: 0, z: -2.8, top: 0.78 };
  const SEAT = new THREE.Vector3(0, 1.2, -3.32);
  const PETITION = { x: 0.05, z: -1.12 };
  const TABLE = { x: 2.55, z: -0.55, top: 0.905, w: 2.0, d: 1.25 };
  const PAPER_W = 0.30, PAPER_H = 0.424;
  const DESK_PAPERS = {
    commerce: { x: -0.82, z: -2.78, r: 0.10 },
    treasury: { x: -0.38, z: -2.70, r: 0.04 },
    cabinet: { x: 0.36, z: -2.71, r: -0.05 },
    bill: { x: 0.0, z: -2.49, r: 0.0 },
  };
  const PHONE_AT = { x: 0.86, z: -2.62, r: -0.35, w: 0.085, h: 0.17 };
  /* Where each of them is when he has nothing for you: the General over the
     map, two of them on the sofas going through their own papers, the Trade
     Representative by the fireplace, the Security Chief and the agents by
     the doors. `sit` puts the body in animChar's own seated pose. */
  const SPOTS = {
    general: { x: 3.95, z: -0.75, face: -Math.PI / 2, path: [[3.95, -0.75], [3.6, -1.6], [1.9, -1.65], [0.5, -1.05]] },
    treasury: { x: -2.86, z: -0.2, face: Math.PI / 2, sit: true, path: [[-2.86, -0.2], [-2.05, -0.85], [-0.2, -0.95]] },
    bank: { x: -0.72, z: 1.4, face: -Math.PI / 2, sit: true, path: [[-0.72, 1.4], [-0.1, 1.6], [0.1, -0.9]] },
    trade: { x: 0.9, z: 3.35, face: -2.6, path: [[0.9, 3.35], [0.4, 2.0], [0.2, -0.9]] },
    security: { x: 3.55, z: 1.75, face: -2.3, path: [[3.55, 1.75], [1.2, 1.1], [0.25, 0.4], [0.35, -0.9]] },
    agentL: { x: -4.25, z: 1.55, face: 2.0 },
    agentR: { x: 4.3, z: 0.85, face: -1.6 },
  };
  const ROLE_CAST = { general: ["officer", 3, "m"], treasury: ["exec", 5, "m"], bank: ["exec", 11, "f"], trade: ["exec", 8, "f"], security: ["agent", 2, "m"], agentL: ["agent", 6, "m"], agentR: ["agent", 9, "m"] };

  let O = null;        // opts from the game: { state(), me(), submit(a), ui, onBack, onDeath }
  let root = null, cam = null, renderer = null;
  const P = {};        // papers: kind -> { paper, mesh, tex, home, drawnDay, dirty }
  let mapMesh = null, phoneMesh = null, folderMesh = null;
  let mode = "seat", focusKind = null;
  const look = { yaw: Math.PI, pitch: -0.26 };
  const view = { pos: SEAT.clone(), quat: new THREE.Quaternion(), t: 1 };
  const read = { d: 0.5, zoom: 1, px: 0, py: 0, t: 0 };
  const mapCam = { x: TABLE.x, z: TABLE.z, h: 1.4 };
  const people = {};
  OF.people = people;

  // ------------------------------------------------------- canvas textures
  function canvasTex(w, h, paint, repeat) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    paint(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    t.anisotropy = 4;
    return t;
  }
  function woodFloor(x, w, h) {
    x.fillStyle = "#6b4a2b"; x.fillRect(0, 0, w, h);
    let s = 7;
    const r = function () { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const pw = w / 8;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) {
      const off = (i % 2) * h / 8;
      const l = 0.85 + r() * 0.3;
      x.fillStyle = "rgb(" + Math.round(118 * l) + "," + Math.round(82 * l) + "," + Math.round(50 * l) + ")";
      x.fillRect(i * pw + 1, j * h / 4 + off + 1, pw - 2, h / 4 - 2);
      x.strokeStyle = "rgba(40,22,10,0.25)"; x.lineWidth = 1;
      for (let k = 0; k < 5; k++) { x.beginPath(); const yy = j * h / 4 + off + r() * h / 4; x.moveTo(i * pw + 2, yy); x.bezierCurveTo(i * pw + pw * 0.3, yy + 4, i * pw + pw * 0.7, yy - 4, i * pw + pw - 2, yy); x.stroke(); }
    }
  }
  function rugTex(x, w, h, name) {
    x.fillStyle = "#e9dcc0"; x.fillRect(0, 0, w, h);
    x.save(); x.translate(w / 2, h / 2);
    x.fillStyle = "#23345e"; x.beginPath(); x.ellipse(0, 0, w * 0.48, h * 0.48, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "#c8a24a"; x.lineWidth = 10; x.beginPath(); x.ellipse(0, 0, w * 0.44, h * 0.44, 0, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 3; x.beginPath(); x.ellipse(0, 0, w * 0.41, h * 0.41, 0, 0, Math.PI * 2); x.stroke();
    // the seal: a ring of stars round the name
    x.fillStyle = "#c8a24a";
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; starPath(x, Math.cos(a) * w * 0.2, Math.sin(a) * h * 0.2, 10); x.fill(); }
    x.beginPath(); x.arc(0, 0, h * 0.13, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#23345e"; x.font = "700 " + Math.round(h * 0.045) + "px Georgia"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText((name || "").toUpperCase(), 0, 0);
    x.restore();
  }
  function starPath(x, X, Y, r) { x.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; x.lineTo(X + Math.cos(a) * rr, Y + Math.sin(a) * rr); } x.closePath(); }
  function windowView(x, w, h) {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#7fb2e6"); g.addColorStop(0.55, "#cfe3f2"); g.addColorStop(0.62, "#9db89a"); g.addColorStop(1, "#4f7a46");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    // the city across the lawn
    let s = 99; const r = function () { s = (s * 16807) % 2147483647; return s / 2147483647; };
    x.fillStyle = "rgba(120,135,150,0.75)";
    for (let i = 0; i < 18; i++) { const bw = 10 + r() * 30, bh = 20 + r() * 110; x.fillRect(r() * w, h * 0.6 - bh, bw, bh); }
    // trees
    for (let i = 0; i < 14; i++) { x.fillStyle = "rgba(48,82,44," + (0.7 + r() * 0.3) + ")"; x.beginPath(); x.arc(r() * w, h * 0.64 + r() * 20, 18 + r() * 26, 0, Math.PI * 2); x.fill(); }
    // mullions
    x.strokeStyle = "#f4efe3"; x.lineWidth = 8;
    for (let i = 1; i < 3; i++) { x.beginPath(); x.moveTo(w * i / 3, 0); x.lineTo(w * i / 3, h); x.stroke(); }
    for (let j = 1; j < 6; j++) { x.beginPath(); x.moveTo(0, h * j / 6); x.lineTo(w, h * j / 6); x.stroke(); }
  }
  function painting(x, w, h) {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#d9c38f"); g.addColorStop(0.6, "#9a8a5c"); g.addColorStop(1, "#4b4a33");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = "rgba(60,50,30,0.5)"; x.beginPath(); x.moveTo(0, h * 0.7); x.quadraticCurveTo(w * 0.3, h * 0.45, w * 0.55, h * 0.62); x.quadraticCurveTo(w * 0.8, h * 0.75, w, h * 0.55); x.lineTo(w, h); x.lineTo(0, h); x.fill();
    x.strokeStyle = "#a07a2a"; x.lineWidth = 18; x.strokeRect(9, 9, w - 18, h - 18);
  }

  // ------------------------------------------------------- merged boxes
  /* The room is a few hundred boxes and it must cost a handful of draws: each
     colour's boxes are merged into ONE geometry. */
  const BOXES = {};
  function bx(x, y, z, w, h, d, color, ry) {
    const k = color;
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry || 0, 0)), new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    (BOXES[k] || (BOXES[k] = [])).push(g.index ? g.toNonIndexed() : g);
    return true;
  }
  // furniture.js's host-box contract: (x, y, z, w, h, d, color, o) with y the box centre
  function hostBox(x, y, z, w, h, d, color) { return bx(x, y, z, w, h, d, color); }
  function flushBoxes(parent) {
    for (const k in BOXES) {
      const list = BOXES[k];
      let n = 0; for (const g of list) n += g.attributes.position.count;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
      let o = 0;
      for (const g of list) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; g.dispose(); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: +k }));
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      parent.add(mesh);
      delete BOXES[k];
    }
  }

  // ------------------------------------------------------------- the room
  function buildRoom(S, me) {
    const c = S.c[me];
    root = new THREE.Group(); root.name = "oval-office";
    CBZ.scene.add(root);
    // floor and rug
    const floorTex = canvasTex(512, 512, woodFloor, [5, 4]);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshLambertMaterial({ map: floorTex }));
    floor.scale.set(RX, RZ, 1); floor.rotation.x = -Math.PI / 2; root.add(floor);
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshLambertMaterial({ map: canvasTex(1024, 820, function (x, w, h) { rugTex(x, w, h, c.name); }) }));
    rug.scale.set(RX * 0.78, RZ * 0.78, 1); rug.rotation.x = -Math.PI / 2; rug.position.y = 0.006; root.add(rug);
    // the oval wall, wainscot and cornice
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xe9dfc6, side: THREE.BackSide });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, WALL_H, 64, 1, true), wallMat);
    wall.scale.set(RX, 1, RZ); wall.position.y = WALL_H / 2; root.add(wall);
    const wain = new THREE.Mesh(new THREE.CylinderGeometry(0.995, 0.995, 0.95, 64, 1, true), new THREE.MeshLambertMaterial({ color: 0xd6c9a8, side: THREE.BackSide }));
    wain.scale.set(RX, 1, RZ); wain.position.y = 0.475; root.add(wain);
    const corn = new THREE.Mesh(new THREE.CylinderGeometry(0.99, 0.99, 0.22, 64, 1, true), new THREE.MeshLambertMaterial({ color: 0xf6f1e4, side: THREE.BackSide }));
    corn.scale.set(RX, 1, RZ); corn.position.y = WALL_H - 0.11; root.add(corn);
    const ceil = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshLambertMaterial({ color: 0xf3efe6, emissive: 0x8a857a }));
    ceil.scale.set(RX, RZ, 1); ceil.rotation.x = Math.PI / 2; ceil.position.y = WALL_H; root.add(ceil);
    // windows behind the desk, with drapes
    const viewTex = canvasTex(512, 1024, windowView);
    for (let i = -1; i <= 1; i++) {
      const a = -Math.PI / 2 + i * 0.42;
      const wx = Math.cos(a) * RX * 0.985, wz = Math.sin(a) * RZ * 0.985;
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 2.3), new THREE.MeshBasicMaterial({ map: viewTex }));
      win.position.set(wx, 1.65, wz); win.lookAt(0, 1.65, 0); root.add(win);
      const yaw = Math.atan2(-wx, -wz);
      for (const sd of [-1, 1]) {
        const ox = Math.cos(yaw) * 0.68 * sd, oz = -Math.sin(yaw) * 0.68 * sd;
        bx(wx + ox, 1.7, wz + oz, 0.34, 3.0, 0.12, 0xb8913a, yaw);
      }
      bx(wx, 2.95, wz, 1.6, 0.25, 0.14, 0xa98232, yaw);
    }
    // doors on the side walls, the fireplace and a painting on the front wall
    for (const sd of [-1, 1]) {
      const a = sd > 0 ? 0.32 : Math.PI - 0.32;
      const dx = Math.cos(a) * RX * 0.985, dz = Math.sin(a) * RZ * 0.985;
      const yaw = Math.atan2(-dx, -dz);
      bx(dx, 1.15, dz, 1.15, 2.3, 0.08, 0xf2ede0, yaw);
      bx(dx - Math.sin(yaw) * 0.04, 1.1, dz - Math.cos(yaw) * 0.04, 0.95, 2.15, 0.06, 0xe4dcc8, yaw);
    }
    bx(0, 0.62, RZ - 0.28, 1.9, 1.24, 0.4, 0xefe8d8);
    bx(0, 1.27, RZ - 0.32, 2.2, 0.1, 0.5, 0xf6f1e4);
    bx(0, 0.45, RZ - 0.12, 0.9, 0.7, 0.2, 0x1b1714);
    const art = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.05), new THREE.MeshLambertMaterial({ map: canvasTex(512, 360, painting) }));
    art.position.set(0, 2.25, RZ - 0.05); art.rotation.y = Math.PI; root.add(art);
    // the desk: two pedestals, a modesty panel with the seal, the top
    const dk = DESK;
    bx(dk.x, dk.top - 0.03, dk.z, 2.1, 0.06, 1.05, 0x4a2d1a);
    bx(dk.x - 0.72, 0.36, dk.z, 0.62, 0.72, 1.0, 0x3f2616);
    bx(dk.x + 0.72, 0.36, dk.z, 0.62, 0.72, 1.0, 0x3f2616);
    bx(dk.x, 0.42, dk.z + 0.46, 0.86, 0.62, 0.05, 0x3a2213);
    bx(dk.x, dk.top + 0.004, dk.z, 1.62, 0.008, 0.7, 0x1f3a2a);
    bx(dk.x - 0.3, dk.top + 0.012, dk.z + 0.06, 0.5, 0.012, 0.36, 0x2a1d14);
    bx(dk.x + 0.62, dk.top + 0.03, dk.z - 0.34, 0.16, 0.05, 0.06, 0xb48a3c);                 // pen set
    bx(dk.x - 0.15, dk.top + 0.03, dk.z + 0.44, 0.34, 0.05, 0.03, 0xb48a3c);                 // nameplate (faces visitors)
    const seal = new THREE.Mesh(new THREE.CircleGeometry(0.2, 32), new THREE.MeshLambertMaterial({ map: canvasTex(256, 256, function (x, w, h) { rugTex(x, w, h, c.name); }) }));
    seal.position.set(dk.x, 0.45, dk.z + 0.49); root.add(seal);
    // the chair behind the desk (you sit in it)
    bx(dk.x, 0.48, dk.z - 0.62, 0.62, 0.12, 0.6, 0x23120a);
    bx(dk.x, 0.95, dk.z - 0.92, 0.62, 0.95, 0.12, 0x23120a);
    // a brass lamp
    bx(dk.x - 0.86, dk.top + 0.2, dk.z - 0.3, 0.03, 0.4, 0.03, 0xb48a3c);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.15, 0.16, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xf6e2a8, side: THREE.DoubleSide }));
    shade.position.set(dk.x - 0.86, dk.top + 0.44, dk.z - 0.3); root.add(shade);
    // flags behind the desk
    for (const sd of [-1, 1]) {
      bx(sd * 1.35, 1.25, dk.z - 0.95, 0.04, 2.5, 0.04, 0xb48a3c);
      const fl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.5), new THREE.MeshLambertMaterial({ color: new THREE.Color(c.color) }));
      fl.position.set(sd * 1.35, 1.85, dk.z - 0.8); fl.rotation.y = sd * 0.3; root.add(fl);
      OF._flags = OF._flags || []; OF._flags.push(fl);
    }
    // the sitting area: furniture.js's own sofas, armchairs and coffee table
    const F = CBZ.furnish;
    const fo = { box: hostBox, solid: false, tone: { cloth: 0xcfc4a2, linen: 0xe8dfc8, wood: 0x3f2616, frame: 0x3f2616 } };
    if (F) {
      try { F.sofa(-2.95, 0, 0.6, Math.PI / 2, fo); F.sofa(-0.65, 0, 0.6, -Math.PI / 2, fo); F.coffee(-1.8, 0, 0.6, 0, fo); } catch (e) { console.warn("[office] furnish", e); }
      try { const fa = Object.assign({}, fo, { tone: { cloth: 0x9c7a32, wood: 0x3f2616, frame: 0x3f2616 } }); F.armchair(-1.75, 0, -1.25, Math.PI + 0.5, fa); F.armchair(0.95, 0, -0.3, Math.PI - 0.5, fa); } catch (e) {}
      try { F.credenza(-3.6, 0, -2.6, Math.PI / 2 + 0.5, fo); F.planter(-4.3, 0, 1.0, 0, fo); F.planter(4.3, 0, 1.0, 0, fo); } catch (e) {}
    } else {
      bx(-2.95, 0.25, 0.6, 0.9, 0.5, 2.0, 0xe7dcc0); bx(-0.65, 0.25, 0.6, 0.9, 0.5, 2.0, 0xe7dcc0); bx(-1.8, 0.22, 0.6, 0.7, 0.44, 1.2, 0x4a2d1a);
    }
    // the map table
    const T = TABLE;
    bx(T.x, T.top - 0.05, T.z, T.w + 0.12, 0.08, T.d + 0.12, 0x3b2516);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(T.x + sx * (T.w / 2 - 0.05), (T.top - 0.09) / 2, T.z + sz * (T.d / 2 - 0.05), 0.08, T.top - 0.09, 0.08, 0x2e1c10);
    flushBoxes(root);
    // the papers
    for (const kind of ["treasury", "commerce", "cabinet", "bill"]) makeDeskPaper(kind);
    // the bill's folder, under its sheet
    folderMesh = new THREE.Mesh(new THREE.BoxGeometry(PAPER_W + 0.04, 0.012, PAPER_H + 0.03), new THREE.MeshLambertMaterial({ color: 0x5a2418 }));
    folderMesh.position.set(DESK_PAPERS.bill.x, DESK.top + 0.022, DESK_PAPERS.bill.z); root.add(folderMesh);
    makePhone();
    makeMap();
    // light: daylight through the windows behind you, a warm room
    const hemi = new THREE.HemisphereLight(0xfff6e6, 0x5a4a38, 0.5); root.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 0.55); sun.position.set(-1, 4, -6); root.add(sun);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.18); fill.position.set(2, 3, 5); root.add(fill);
    root.add(new THREE.AmbientLight(0xffffff, 0.06));
  }

  // ------------------------------------------------------------ the papers
  function paperMat(tex) { return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }); }
  function makeDeskPaper(kind) {
    const pap = CBZ.presPapers.make(kind);
    const tex = new THREE.CanvasTexture(pap.canvas);
    tex.encoding = THREE.sRGBEncoding; tex.anisotropy = maxAniso(); tex.minFilter = THREE.LinearMipmapLinearFilter;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PAPER_W, PAPER_H), paperMat(tex));
    const at = DESK_PAPERS[kind];
    mesh.position.set(at.x, DESK.top + (kind === "bill" ? 0.03 : 0.021), at.z);
    mesh.rotation.set(-Math.PI / 2, 0, at.r + Math.PI);      // the top of the page away from you
    mesh.userData.paper = kind;
    root.add(mesh);
    P[kind] = { paper: pap, mesh: mesh, tex: tex, home: { pos: mesh.position.clone(), quat: mesh.quaternion.clone() }, drawn: -1, dirty: true, t: 0, size: [PAPER_W, PAPER_H] };
  }
  function makePhone() {
    const pap = CBZ.presPapers.make("phone");
    const tex = new THREE.CanvasTexture(pap.canvas); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = maxAniso();
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(PHONE_AT.w + 0.008, 0.009, PHONE_AT.h + 0.008), new THREE.MeshLambertMaterial({ color: 0x15171c }));
    g.add(body);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(PHONE_AT.w, PHONE_AT.h), paperMat(tex));
    scr.rotation.x = -Math.PI / 2; scr.rotation.z = Math.PI; scr.position.y = 0.0048;
    scr.userData.paper = "phone";
    g.add(scr);
    g.position.set(PHONE_AT.x, DESK.top + 0.021, PHONE_AT.z); g.rotation.y = PHONE_AT.r;
    root.add(g);
    phoneMesh = scr;
    P.phone = { paper: pap, mesh: scr, group: g, tex: tex, home: null, drawn: -1, dirty: true, t: 0, size: [PHONE_AT.w, PHONE_AT.h] };
  }
  function makeMap() {
    const pap = CBZ.presPapers.make("map");
    const tex = new THREE.CanvasTexture(pap.canvas); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = maxAniso();
    mapMesh = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.w, TABLE.d), paperMat(tex));
    mapMesh.rotation.set(-Math.PI / 2, 0, Math.PI);
    mapMesh.position.set(TABLE.x, TABLE.top, TABLE.z);
    mapMesh.userData.paper = "map";
    root.add(mapMesh);
    P.map = { paper: pap, mesh: mapMesh, tex: tex, home: null, drawn: -1, dirty: true, t: 0, size: [TABLE.w, TABLE.d] };
  }
  function maxAniso() { try { return Math.min(8, renderer.capabilities.getMaxAnisotropy()); } catch (e) { return 4; } }
  function redraw(kind, force) {
    const it = P[kind]; if (!it) return;
    const S = O.state();
    CBZ.presPapers.draw(it.paper, S, O.ui);
    it.tex.needsUpdate = true;
    it.drawn = S.day; it.dirty = false; it.t = 0;
  }
  OF.paper = function (kind) { return P[kind] ? { ver: P[kind].paper.ver, drawn: P[kind].drawn, dirty: P[kind].dirty, t: P[kind].t } : null; };
  OF.redraw = function (kind) { if (kind) { if (P[kind]) P[kind].dirty = true; } else for (const k in P) P[k].dirty = true; };

  // ------------------------------------------------------------ the people
  function makePeople(S, me) {
    const c = S.c[me];
    for (const role in ROLE_CAST) {
      const rc = ROLE_CAST[role];
      let g = null;
      try { g = CBZ.studio && CBZ.studio.cast ? CBZ.studio.cast(rc[0], { variant: rc[1] + me * 13, build: rc[2] }) : null; } catch (e) { g = null; }
      if (!g) { g = new THREE.Group(); const b = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.7, 10), new THREE.MeshLambertMaterial({ color: 0x2b2e36 })); b.position.y = 0.85; g.add(b); }
      const sp = SPOTS[role];
      g.position.set(sp.x, 0, sp.z); g.rotation.y = sp.face;
      root.add(g);
      // an invisible column to tap
      const hitM = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.85, 8), new THREE.MeshBasicMaterial({ visible: false }));
      hitM.position.y = 0.92; hitM.userData.person = role; g.add(hitM);
      const ch = g.userData && g.userData.charRig;
      people[role] = {
        role: role, group: g, char: ch, pos: g.position, armed: false, weapon: "Pistol", dead: false,
        path: null, pi: 0, speed: 0, busy: null, home: sp, isAgent: role.indexOf("agent") === 0, name: role,
      };
    }
    for (const k in people) sitDown(people[k], !!people[k].home.sit);
    if (CBZ.animChar) for (const k in people) { const pp = people[k]; if (pp.char) for (let i = 0; i < 30; i++) { try { CBZ.animChar(pp.char, 0, 1 / 30); } catch (e) {} } }
    nameCabinet(S, me);
  }
  function sitDown(pp, on) {
    if (!pp.char) return;
    // the sofa's own cushion (furniture.js: 0.40 m), so the hips land on it
    pp.char.seatRef = on ? { cushion: 0.40, floorBelow: 0, kind: "sofa" } : null;
    if (CBZ.setCharPose) { try { CBZ.setCharPose(pp.char, on ? "sit" : null); return; } catch (e) {} }
    pp.char.sitting = on;
  }
  function nameCabinet(S, me) {
    const c = S.c[me];
    for (const role of CBZ.presWorld.ROLES) if (people[role]) people[role].name = c.cab[role].name;
    if (people.agentL) people.agentL.name = "Agent";
    if (people.agentR) people.agentR.name = "Agent";
  }
  function walkTo(pp, pts, then) {
    sitDown(pp, false);
    pp.path = pts.map(function (q) { return new THREE.Vector3(q[0], 0, q[1]); });
    pp.pi = 0; pp.then = then || null;
  }
  function facePoint(pp, x, z, dt) {
    const want = Math.atan2(x - pp.group.position.x, z - pp.group.position.z);
    let d = want - pp.group.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    pp.group.rotation.y += d * Math.min(1, (dt || 1) * 6);
  }
  function updatePeople(dt) {
    for (const k in people) {
      const pp = people[k];
      if (pp.dead) continue;
      let spd = 0;
      if (pp.path && pp.pi < pp.path.length) {
        const tgt = pp.path[pp.pi], g = pp.group.position;
        const dx = tgt.x - g.x, dz = tgt.z - g.z, dl = Math.hypot(dx, dz);
        const v = 1.35;
        if (dl < 0.05) { pp.pi++; if (pp.pi >= pp.path.length) { pp.path = null; const t = pp.then; pp.then = null; if (t) t(); } }
        else { const st = Math.min(dl, v * dt); g.x += dx / dl * st; g.z += dz / dl * st; facePoint(pp, tgt.x, tgt.z, dt * 2); spd = v; }
      } else if (pp.faceCam) facePoint(pp, cam.position.x, cam.position.z, dt);
      else if (!pp.busy) { const want = pp.home.face; let d = want - pp.group.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; pp.group.rotation.y += d * Math.min(1, dt * 3); }
      if (pp.char && CBZ.animChar) { try { CBZ.animChar(pp.char, spd, dt); } catch (e) {} }
      if (pp.aimAt && CBZ.actorAimAt) { try { CBZ.actorAimAt(pp, pp.aimAt, dt); } catch (e) {} }
    }
  }
  function goHome(pp) {
    if (lookHint === pp) hintLook(null);
    pp.faceCam = false;
    const sp = pp.home;
    const path = (sp.path || [[sp.x, sp.z]]).slice().reverse();
    walkTo(pp, path, function () { pp.busy = null; pp.group.rotation.y = sp.face; if (sp.sit) sitDown(pp, true); });
  }
  function speak(pp, text, secs) {
    if (!text) return;
    try { if (CBZ.speech && CBZ.speech.say) CBZ.speech.say(pp, text, { force: true, important: true, secs: secs || 3.5 }); } catch (e) {}
  }
  OF.say = function (role, text) { const pp = people[role]; if (pp) speak(pp, text); };

  // ---------------------------------------------------- matters, delivered
  /* A cabinet matter: the person walks to the desk and says it, and the
     answers are the three-answer prompt. While he walks the world goes on. */
  const queue = [];
  let asking = null;
  OF.deliver = function (m) {
    if (queue.some(function (q) { return q.id === m.id; }) || (asking && asking.id === m.id)) return;
    queue.push(m);
  };
  function pumpQueue() {
    if (asking || !queue.length) return;
    const m = queue.shift();
    const S = O.state(), c = S.c[O.me()];
    if (!c.matters.some(function (q) { return q.id === m.id; })) return;           // answered elsewhere, or gone
    if (m.kind === "coup" || m.kind === "traitor") { OF.scene(m.kind, m); return; }
    const pp = people[m.from];
    if (!pp) { ask(m, null); return; }
    asking = m;
    pp.busy = m;
    const sp = SPOTS[m.from];
    walkTo(pp, sp && sp.path ? sp.path.slice(1).concat([[PETITION.x, PETITION.z]]) : [[PETITION.x, PETITION.z]], function () {
      pp.faceCam = true;
      ask(m, pp);
    });
  }
  function ask(m, pp) {
    asking = m;
    if (pp) hintLook(pp);
    const S = O.state(), me = O.me();
    const line = CBZ.presHoller.line(S, me, m);
    const name = pp ? pp.name : CBZ.presPapers.callerName(S, me, m);
    const choices = m.opts.map(function (o, i) {
      return { id: "o" + i, label: o.label, value: i, onSelect: function () { answer(m, i, pp); } };
    });
    if (O.onPrompt) O.onPrompt(true);
    const done = function () { if (O.onPrompt) O.onPrompt(false); };
    prompt(name, line, choices, pp, 14).then(function (v) {
      done();
      if (v == null || v === "silence") { asking = null; if (pp) goHome(pp); }
    });
  }
  function answer(m, i, pp) {
    O.submit({ type: "answer", m: m.id, o: i });
    asking = null;
    if (pp) {
      const ok = ["Yes, sir.", "Right away.", "Understood."];
      setTimeout(function () { if (!pp.dead) { speak(pp, ok[(m.id + i) % ok.length], 1.8); goHome(pp); } }, 250);
    }
  }
  // the three-answer prompt: campaign_ui's cinematic one, or a plain one
  function prompt(name, line, choices, actor, timeout) {
    const UI = CBZ.campaignUI;
    if (UI && UI.say) {
      try { return Promise.resolve(UI.say(name, line, choices, { cinematic: true, actor: actor || null, timeout: timeout || 12 })); } catch (e) { console.warn("[office] prompt", e); }
    }
    return fallbackPrompt(name, line, choices);
  }
  function fallbackPrompt(name, line, choices) {
    return new Promise(function (res) {
      const el = document.createElement("div");
      el.className = "pres-prompt";
      el.innerHTML = "<b></b><p></p><div></div>";
      el.querySelector("b").textContent = name; el.querySelector("p").textContent = line;
      const row = el.querySelector("div");
      choices.forEach(function (c) {
        const b = document.createElement("button"); b.textContent = c.label;
        b.onclick = function () { el.remove(); try { c.onSelect && c.onSelect(c.value); } catch (e) {} res(c.value); };
        row.appendChild(b);
      });
      document.body.appendChild(el);
      setTimeout(function () { if (el.parentNode) { el.remove(); res("silence"); } }, 14000);
    });
  }

  // a call from abroad: the phone rings until you pick it up
  let ringing = [];
  OF.ring = function (m) { if (!ringing.some(function (q) { return q.id === m.id; })) ringing.push(m); OF.redraw("phone"); };
  let ringT = 0;
  function updateRing(dt) {
    const S = O.state(), c = S.c[O.me()];
    ringing = ringing.filter(function (m) { return c.matters.some(function (q) { return q.id === m.id; }); });
    if (!ringing.length || !P.phone) { if (P.phone && P.phone.group) P.phone.group.position.y = DESK.top + 0.021; return; }
    ringT += dt;
    const on = (ringT % 3) < 1.4;
    if (P.phone.group && mode !== "paper") P.phone.group.position.y = DESK.top + 0.021 + (on ? Math.abs(Math.sin(ringT * 60)) * 0.004 : 0);
    if (on && Math.floor(ringT * 6) !== Math.floor((ringT - dt) * 6)) trill();
  }
  let actx = null;
  function trill() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime, g = actx.createGain();
      g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      const o = actx.createOscillator(); o.type = "square"; o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1046, t + 0.07);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.16);
    } catch (e) {}
  }
  function bang(vol) {
    try {
      if (CBZ.micro && CBZ.micro.sfx && CBZ.micro.sfx.boom) { CBZ.micro.sfx.boom({ gain: vol || 0.9, dur: 0.5, bright: true, sub: 140 }); return; }
    } catch (e) {}
  }

  // ------------------------------------------------------------- scenes
  /* The two matters that come through the door with a gun.
     coup:    the General and two soldiers. Step down, or have him arrested.
     traitor: the Security Chief's man, the resignation in one hand, the
              pistol in the other. Sign, or refuse.
     The answer goes to the world; who dies is the world's roll
     (apply "arrest" / "defy"), read back off the log. */
  let SC = null;
  OF.scene = function (kind, m) {
    if (SC) return;
    const S = O.state(), me = O.me();
    OF.back(true);
    const asker = kind === "coup" ? people.general : people.agentR || people.security;
    if (!asker) { ask(m, null); return; }
    SC = { kind: kind, m: m, asker: asker, extra: [], answered: false };
    asker.busy = m;
    if (kind === "coup") {
      // two soldiers come in behind him
      for (let i = 0; i < 2; i++) {
        let g = null;
        try { g = CBZ.studio.cast("soldier", { variant: 40 + i }); } catch (e) { g = null; }
        if (!g) continue;
        g.position.set(4.0 - i * 0.5, 0, 2.2); root.add(g);
        const sp = { role: "soldier" + i, group: g, char: g.userData.charRig, pos: g.position, armed: true, weapon: "Rifle", dead: false, home: { x: 4, z: 2.2, face: -2 }, busy: m, name: "Soldier" };
        people["soldier" + i] = sp; SC.extra.push(sp);
        walkTo(sp, [[1.6 - i * 3.2, -1.2]], function () { sp.faceCam = true; sp.aimAt = { pos: cam.position }; });
      }
    }
    const path = kind === "coup" ? [[3.6, -1.6], [1.9, -1.65], [PETITION.x, PETITION.z]] : [[2.6, 1.2], [0.25, 0.4], [PETITION.x, PETITION.z]];
    walkTo(asker, path, function () {
      asker.faceCam = true; hintLook(asker);
      asker.armed = true; asker.weapon = "Pistol";
      if (kind === "traitor") asker.aimAt = { pos: cam.position };
      const line = CBZ.presHoller.line(S, me, m);
      const choices = m.opts.map(function (o, i) {
        return { id: "o" + i, label: o.label, value: i, onSelect: function () { SC.answered = true; O.submit({ type: "answer", m: m.id, o: i }); } };
      });
      if (O.onPrompt) O.onPrompt(true);
      prompt(asker.name, line, choices, asker, 10).then(function (v) {
        if (O.onPrompt) O.onPrompt(false);
        if (v == null || v === "silence") { if (!SC.answered) { SC.answered = true; O.submit({ type: "answer", m: m.id, o: 1 }); } }
      });
    });
  };
  // the world has answered: the guards shoot first, or he does
  OF.outcome = function (ev) {
    if (!SC) return;
    const survived = ev.k === "coupFailed" || ev.k === "plotFoiled";
    const fell = ev.k === "fall";
    if (!survived && !fell) return;
    const sc = SC; SC = null;
    setTimeout(function () { hintLook(null); }, 2500);
    const a = sc.asker;
    if (survived) {
      const guard = people.agentL && !people.agentL.dead ? people.agentL : people.agentR;
      if (guard && guard !== a) {
        guard.armed = true; guard.weapon = "Pistol"; guard.aimAt = { pos: a.pos };
        setTimeout(function () { shoot(guard, a); }, 500);
        setTimeout(function () { shoot(guard, a); }, 800);
      }
      sc.extra.forEach(function (s) { s.aimAt = null; s.faceCam = false; walkTo(s, [[4.0, 2.2]], function () { s.group.visible = false; }); });
      setTimeout(function () { a.aimAt = null; }, 1600);
    } else {
      if (ev.why === "resigned") { if (O.onDeath) setTimeout(function () { O.onDeath("resigned"); }, 1200); a.aimAt = null; return; }
      a.aimAt = { pos: cam.position };
      setTimeout(function () { shoot(a, null); }, 350);
      setTimeout(function () { shoot(a, null); }, 650);
      sc.extra.forEach(function (s, i) { setTimeout(function () { shoot(s, null); }, 450 + i * 160); });
      setTimeout(function () { dieCam(); if (O.onDeath) O.onDeath(ev.why || "shot"); }, 900);
    }
  };
  const _m = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3();
  function shoot(from, target) {
    if (!from || from.dead) return;
    try {
      if (CBZ.actorMuzzle) CBZ.actorMuzzle(from, _m); else _m.set(from.pos.x, 1.4, from.pos.z);
    } catch (e) { _m.set(from.pos.x, 1.4, from.pos.z); }
    if (target) _t.set(target.pos.x, 1.3, target.pos.z); else _t.copy(cam.position);
    _d.copy(_t).sub(_m).normalize();
    try { if (CBZ.muzzleFlash) CBZ.muzzleFlash(_m, { dir: _d, scale: 0.8 }); } catch (e) {}
    try { if (CBZ.tracer) CBZ.tracer(_m.clone(), _t.clone(), {}); } catch (e) {}
    bang(0.8);
    if (target && !target.dead) {
      target.dead = true; target.aimAt = null; target.faceCam = false; target.armed = false;
      let rag = false;
      try { if (CBZ.cityRagdoll) rag = CBZ.cityRagdoll(target, { x: target.pos.x, y: 1.3, z: target.pos.z }, { x: _d.x, y: 0, z: _d.z }, 1.2); } catch (e) { rag = false; }
      if (!rag) { target.group.rotation.x = -Math.PI / 2; target.group.position.y = 0.15; }
    }
  }
  let dying = 0;
  function dieCam() { dying = 0.0001; }

  // ---------------------------------------------------------- the camera
  function seatQuat(out) { return out.setFromEuler(new THREE.Euler(look.pitch, look.yaw, 0, "YXZ")); }
  const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _mx = new THREE.Matrix4();
  function readingPose(it, outPos, outQuat) {
    // the paper held in front of the eyes, filling the view
    const fov = cam.fov * Math.PI / 180, asp = cam.aspect;
    const w = it.size[0], h = it.size[1];
    const vis = 2 * Math.tan(fov / 2);
    const dFitH = h / (vis * 0.94), dFitW = w / (vis * asp * 0.94);
    let d = Math.max(dFitH, dFitW);
    // never smaller than readable: on a small screen, fit the width and scroll
    const screenH = window.innerHeight || 600;
    const cssPerPx = function (dd) { return (screenH / (vis * dd)) * (h / it.paper.H); };
    if (cssPerPx(d) < 0.42) d = Math.min(d, Math.max(dFitW, (screenH / (vis * 0.42)) * (h / it.paper.H)));
    d /= read.zoom;
    read.d = d;
    const visH = vis * d, visW = visH * asp;
    const mxX = Math.max(0, (w - visW) / 2), mxY = Math.max(0, (h - visH) / 2);
    read.px = Math.max(-mxX, Math.min(mxX, read.px)); read.py = Math.max(-mxY, Math.min(mxY, read.py));
    seatQuat(outQuat);
    _v.set(-read.px, -read.py, -d).applyQuaternion(outQuat);
    outPos.copy(SEAT).add(_v);
  }
  function mapPose(outPos, outQuat) {
    const T = TABLE;
    mapCam.h = Math.max(0.35, Math.min(fitMapH(), mapCam.h));
    const hw = T.w / 2, hd = T.d / 2;
    mapCam.x = Math.max(T.x - hw, Math.min(T.x + hw, mapCam.x));
    mapCam.z = Math.max(T.z - hd, Math.min(T.z + hd, mapCam.z));
    outPos.set(mapCam.x, T.top + mapCam.h, mapCam.z + mapCam.h * 0.08);
    _mx.lookAt(outPos, new THREE.Vector3(mapCam.x, T.top, mapCam.z), new THREE.Vector3(0, 0, 1));
    outQuat.setFromRotationMatrix(_mx);
  }
  function fitMapH() {
    const fov = cam.fov * Math.PI / 180, vis = 2 * Math.tan(fov / 2), asp = cam.aspect;
    return Math.max(TABLE.d / (vis * 0.96), TABLE.w / (vis * asp * 0.96));
  }
  OF.mode = function () { return mode; };
  OF.focus = function (kind) {
    if (SC) return;
    if (kind === "bill" && !hasBill()) return;
    if (kind === "map") { mode = "map"; focusKind = "map"; mapCam.x = TABLE.x; mapCam.z = TABLE.z; mapCam.h = fitMapH(); P.map.dirty = true; }
    else { mode = "paper"; focusKind = kind; read.zoom = 1; read.px = 0; read.py = 99; read.t = 0; P[kind].dirty = true; }   // a page is read from the top
    if (kind === "phone") { O.ui.phoneTab = ringing.length ? "calls" : O.ui.phoneTab || "holler"; }
    view.t = 0;
    if (O.onMode) O.onMode(mode, kind);
  };
  OF.back = function (quiet) {
    if (mode === "seat") return;
    const k = focusKind;
    mode = "seat"; focusKind = null; view.t = 0;
    if (k && P[k] && P[k].home) { P[k].mesh.position.copy(P[k].home.pos); P[k].mesh.quaternion.copy(P[k].home.quat); }
    if (k === "phone" && P.phone.group) { P.phone.group.add(P.phone.mesh); P.phone.mesh.position.set(0, 0.0048, 0); P.phone.mesh.rotation.set(-Math.PI / 2, 0, Math.PI); }
    if (O.ui) { O.ui.call = null; O.ui.dial = null; }
    if (O.onMode && !quiet) O.onMode(mode, null);
    else if (O.onMode) O.onMode(mode, null);
  };
  function hasBill() { const S = O.state(); return S.c[O.me()].matters.some(function (m) { return m.kind === "bill"; }); }

  const _cp = new THREE.Vector3(), _cq = new THREE.Quaternion();
  /* WHO IS TALKING TO YOU, YOU LOOK AT. When somebody stands at the desk and
     speaks, the seated eye lifts to his face (a standing man two metres away
     is above a seated man's line of sight); when he goes, it settles back on
     the desk. A drag always wins: the hint only eases while you are not
     looking somewhere yourself. */
  let lookHint = null, lookRest = null, userLookT = 0;
  function hintLook(pp) {
    if (!pp) { lookHint = null; return; }
    if (!lookRest) lookRest = { yaw: look.yaw, pitch: look.pitch };
    lookHint = pp;
  }
  function easeLook(dt) {
    userLookT = Math.max(0, userLookT - dt);
    if (mode !== "seat" || userLookT > 0) return;
    let wy, wp;
    if (lookHint && !lookHint.dead) {
      const g = lookHint.group.position;
      const dx = g.x - SEAT.x, dz = g.z - SEAT.z, dy = 1.62 - SEAT.y;
      wy = Math.atan2(-dx, -dz); wp = Math.atan2(dy, Math.hypot(dx, dz)) - 0.22;
    } else if (lookRest) { wy = lookRest.yaw; wp = lookRest.pitch; }
    else return;
    let d = wy - look.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    const k = Math.min(1, dt * 2.5);
    look.yaw += d * k; look.pitch += (wp - look.pitch) * k;
    if (!lookHint && lookRest && Math.abs(d) < 0.01 && Math.abs(wp - look.pitch) < 0.01) lookRest = null;
  }
  function updateCamera(dt) {
    easeLook(dt);
    view.t = Math.min(1, view.t + dt * 3.2);
    const e = 1 - Math.pow(1 - view.t, 3);
    if (mode === "map") { mapPose(_cp, _cq); }
    else { _cp.copy(SEAT); seatQuat(_cq); }
    if (dying > 0) {
      dying += dt;
      const f = Math.min(1, dying / 1.2);
      _cp.y = SEAT.y - f * 0.95; _cq.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(f * 0.5, 0, f * 1.1)));
    }
    cam.position.lerp(_cp, view.t >= 1 ? 1 : e * 0.5 + 0.02);
    cam.quaternion.slerp(_cq, view.t >= 1 ? 1 : e * 0.5 + 0.02);
    if (mode === "map") { cam.near = 0.05; } else cam.near = 0.05;
    cam.updateProjectionMatrix();
    // the paper in your hands
    if (mode === "paper" && focusKind && P[focusKind]) {
      const it = P[focusKind];
      readingPose(it, _cp, _cq);
      read.t = Math.min(1, read.t + dt * 4);
      const k = 1 - Math.pow(1 - read.t, 3);
      if (focusKind === "phone" && it.mesh.parent !== root) { root.attach(it.mesh); }
      it.mesh.position.lerp(_cp, read.t >= 1 ? 1 : k * 0.6 + 0.05);
      it.mesh.quaternion.slerp(_cq, read.t >= 1 ? 1 : k * 0.6 + 0.05);
    }
  }

  // ----------------------------------------------------------- input
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ptrs = new Map();
  let drag = null, pinch = null;
  function pick(cx, cy) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const targets = [];
    if (mode === "paper" && focusKind) targets.push(P[focusKind].mesh);
    else if (mode === "map") targets.push(mapMesh);
    else {
      for (const k of ["treasury", "commerce", "cabinet"]) targets.push(P[k].mesh);
      if (hasBill()) targets.push(P.bill.mesh);
      targets.push(phoneMesh, mapMesh);
      for (const k in people) { const pp = people[k]; if (!pp.dead) pp.group.traverse(function (o) { if (o.userData && o.userData.person) targets.push(o); }); }
    }
    const hits = ray.intersectObjects(targets, false);
    return hits[0] || null;
  }
  function onTap(cx, cy) {
    if (SC && !SC.answered) return;
    const h = pick(cx, cy);
    if (!h) { if (mode !== "seat") OF.back(); return; }
    const o = h.object;
    if (o.userData.person) { tapPerson(o.userData.person); return; }
    const kind = o.userData.paper;
    if (!kind) return;
    if (mode === "seat") { OF.focus(kind); return; }
    // a tap on the paper in your hands: the box under your finger
    const it = P[kind], uv = h.uv;
    if (!uv) return;
    const X = uv.x * it.paper.W, Y = (1 - uv.y) * it.paper.H;
    const hit = CBZ.presPapers.hit(it.paper, X, Y);
    if (!hit) return;
    press(kind, hit, X, Y);
  }
  function press(kind, hit, X, Y) {
    const ui = O.ui, S = O.state();
    if (hit.act) {
      const a = JSON.parse(JSON.stringify(hit.act));
      O.submit(a);
      flashBox(kind, hit);
      if (hit.hangup) { ui.dial = null; ui.call = null; }
    } else if (hit.fn === "tab") { ui.phoneTab = hit.tab; ui.call = null; ui.dial = null; }
    else if (hit.fn === "dial") { ui.dial = hit.c; ui.call = null; }
    else if (hit.fn === "pickup") { ui.call = hit.m; ui.phoneTab = "calls"; }
    else if (hit.fn === "hangup") { ui.call = null; ui.dial = null; }
    else if (hit.fn === "answer") { O.submit({ type: "answer", m: hit.m, o: hit.o }); ui.call = null; flashBox(kind, hit); }
    else if (hit.fn === "mapTap") {
      const M = CBZ.presWorld.geo(S.seed, S.nC);
      const cs = CBZ.presPapers.MAPW / M.W;
      const tx = Math.floor(X / cs), ty = Math.floor(Y / cs);
      const pv = M.cell[ty * M.W + tx];
      if (pv >= 0) { ui.sel = S.p[pv].ctl === O.me() && ui.sel === O.me() ? O.me() : S.p[pv].ctl; ui.selP = pv; }
      else { ui.sel = null; ui.selP = null; }
    }
    P[kind].dirty = true;
    if (kind !== "map") P.map.dirty = true;
  }
  // the box you tapped darkens for a beat: it was pressed
  function flashBox(kind, hit) {
    const it = P[kind]; const x = it.paper.ctx;
    x.save(); x.fillStyle = "rgba(31,63,122,0.35)"; x.fillRect(hit.x, hit.y, hit.w, hit.h); x.restore();
    it.tex.needsUpdate = true;
    setTimeout(function () { it.dirty = true; }, 220);
  }
  function tapPerson(role) {
    const pp = people[role]; if (!pp || pp.dead || pp.busy || asking) return;
    const S = O.state(), me = O.me(), c = S.c[me];
    if (pp.isAgent) { speak(pp, ["Sir.", "All clear, sir."][S.day % 2], 2); return; }
    const pending = c.matters.find(function (m) { return m.from === role; });
    if (pending) { OF.deliver(pending); return; }
    const line = CBZ.presHoller.standing(S, me, role);
    pp.faceCam = true; hintLook(pp);
    if (O.onPrompt) O.onPrompt(true);
    prompt(pp.name, line, [
      { id: "keep", label: "Keep him on", value: "keep", onSelect: function () {} },
      { id: "fire", label: "Fire him", value: "fire", onSelect: function () { O.submit({ type: "fire", role: role }); speak(pp, "You'll regret this.", 2.4); } },
    ], pp, 8).then(function () { if (O.onPrompt) O.onPrompt(false); pp.faceCam = false; hintLook(null); });
  }
  function bindInput(el) {
    el.addEventListener("pointerdown", function (e) {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
      if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0 };
      if (ptrs.size === 2) { const a = Array.from(ptrs.values()); pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), z: read.zoom, h: mapCam.h }; drag = null; }
      try { el.setPointerCapture(e.pointerId); } catch (er) {}
    });
    el.addEventListener("pointermove", function (e) {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pinch && ptrs.size === 2) {
        const a = Array.from(ptrs.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        const f = d / Math.max(1, pinch.d);
        if (mode === "paper") read.zoom = Math.max(1, Math.min(4, pinch.z * f));
        else if (mode === "map") mapCam.h = Math.max(0.35, pinch.h / f);
        return;
      }
      if (!drag) return;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved < 8) return;
      const s = 1 / (window.innerHeight || 600);
      if (mode === "seat") { userLookT = 1.5; look.yaw -= dx * s * 2.2; look.pitch = Math.max(-1.25, Math.min(0.5, look.pitch - dy * s * 2.2)); }
      else if (mode === "paper") { read.px += dx * s * read.d * 1.3; read.py -= dy * s * read.d * 1.3; }
      else if (mode === "map") { mapCam.x += dx * s * mapCam.h * 1.25; mapCam.z += dy * s * mapCam.h * 1.25; }
    });
    const up = function (e) {
      const p = ptrs.get(e.pointerId);
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (drag && p && drag.moved < 8 && ptrs.size === 0) onTap(e.clientX, e.clientY);
      if (ptrs.size === 0) drag = null;
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", function (e) { ptrs.delete(e.pointerId); drag = null; pinch = null; });
    el.addEventListener("wheel", function (e) {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      if (mode === "paper") read.zoom = Math.max(1, Math.min(4, read.zoom * f));
      else if (mode === "map") mapCam.h = Math.max(0.35, mapCam.h / f);
      else { look.pitch = Math.max(-1.25, Math.min(0.5, look.pitch - e.deltaY * 0.001)); }
    }, { passive: false });
    window.addEventListener("keydown", function (e) {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      const k = e.key;
      if (k === "Escape" || k === "Backspace") { OF.back(); return; }
      const map = { "1": "treasury", "2": "commerce", "3": "cabinet", "4": "map", "5": "phone", "b": "bill", "B": "bill", "m": "map", "M": "map" };
      if (map[k]) { if (focusKind === map[k]) OF.back(); else { OF.back(true); OF.focus(map[k]); } return; }
      const st = 0.06;
      if (mode === "seat") {
        if (k === "ArrowLeft") look.yaw += st * 2; if (k === "ArrowRight") look.yaw -= st * 2;
        if (k === "ArrowUp") look.pitch = Math.min(0.5, look.pitch + st); if (k === "ArrowDown") look.pitch = Math.max(-1.25, look.pitch - st);
      } else if (mode === "paper") {
        if (k === "ArrowUp") read.py -= 0.03; if (k === "ArrowDown") read.py += 0.03;
        if (k === "=" || k === "+") read.zoom = Math.min(4, read.zoom * 1.2); if (k === "-") read.zoom = Math.max(1, read.zoom / 1.2);
      } else if (mode === "map") {
        if (k === "ArrowLeft") mapCam.x += 0.08; if (k === "ArrowRight") mapCam.x -= 0.08; if (k === "ArrowUp") mapCam.z += 0.08; if (k === "ArrowDown") mapCam.z -= 0.08;
        if (k === "=" || k === "+") mapCam.h /= 1.2; if (k === "-") mapCam.h *= 1.2;
      }
    });
  }

  // ------------------------------------------------------------- per frame
  let lastDay = -1;
  OF.update = function (dt) {
    if (!root) return;
    const S = O.state();
    if (S.day !== lastDay) { lastDay = S.day; nameCabinet(S, O.me()); }
    // which papers are worth redrawing now
    for (const k in P) {
      const it = P[k];
      it.t += dt;
      const focused = k === focusKind;
      const want = it.dirty ? (focused ? 0.05 : 0.4) : focused ? (S.day !== it.drawn ? 0.35 : 1e9) : (S.day !== it.drawn ? (k === "map" ? 2.5 : 4 + (k.length % 3)) : 1e9);
      if (it.t >= want) redraw(k);
    }
    // the bill's folder is on the desk only while there is a bill
    const bill = hasBill();
    P.bill.mesh.visible = bill || focusKind === "bill"; folderMesh.visible = bill;
    pumpQueue();
    updateRing(dt);
    updatePeople(dt);
    updateCamera(dt);
  };

  OF.init = function (opts) {
    O = opts;
    cam = CBZ.camera; renderer = CBZ.renderer;
    cam.fov = window.innerWidth < window.innerHeight ? 70 : 58; cam.near = 0.05; cam.far = 60; cam.updateProjectionMatrix();
    const S = O.state(), me = O.me();
    if (CBZ.scene.fog) CBZ.scene.fog = null;
    CBZ.scene.background = new THREE.Color(0x1a1612);
    buildRoom(S, me);
    makePeople(S, me);
    cam.position.copy(SEAT); seatQuat(cam.quaternion);
    bindInput(renderer.domElement);
    for (const k in P) redraw(k);
    // the shot that ends a fatal answer is ours (campaign_ui calls it)
    CBZ.cinematicShoot = function () { return null; };
  };
  OF.flagColor = function (hex) { (OF._flags || []).forEach(function (f) { f.material.color.set(hex); }); };
})();
