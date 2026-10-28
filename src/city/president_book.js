/* ============================================================
   city/president_book.js — THE BRIEFING BOOK ON THE PRESIDENT'S DESK.

   OWNER (2026-10-28): "There's documents on the desk that go down past the
   bottom of the page, and you can't scroll — it shouldn't be a scroll, it
   should be changing pages or something realistic."

   A leather binder lies at the President's right hand on the Resolute desk
   (president_office.js builds the desk; this file only puts the book on it).
   Read it (E, or a tap on it) and it opens flat on the blotter and the
   camera leans over the open spread: two real pages, side by side, on a
   landscape screen; one page at a time on a phone held upright. Every page
   fits its page (president/papers.js paints them; tools/
   president-pages-check.mjs holds the margins).

   TURNING A PAGE is turning a page: the leaf lifts off the right-hand side,
   swings over the spine and lands on the left, and the next spread is
   under it.
     keyboard     Right / Left arrow (or D / A); Esc or E closes it
     mouse/touch  the curled corner at the bottom of a page turns it; a swipe
                  across the book turns it; a tap off the book closes it; a
                  tap on a box on the page is that decision
     controller   (only while one is in use) the d-pad or LB / RB turns, the
                  left stick moves a pointer over the page, A presses, B closes

   The book has no idea what is in it: president_game.js hands it a source
   { pages(), paint(ctx, id), press(hit, x, y), version() }.

   PUBLIC  CBZ.presBook = { setSource(src), open(), close(), isOpen(), turn(dir),
     audit(), _tapPage(side, x, y) }   CBZ.presBookOpen (flag, read by
   camera.js, seat_exit.js, gamepad.js, president_office.js)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || CBZ.presBook) return;
  const g = CBZ.game || (CBZ.game = {});

  // ---- the object: a letter binder, closed at the right hand, open on the blotter
  const PAGE_W = 0.215, PAGE_H = 0.287, GUTTER = 0.012;
  const BOOK_W = 0.235, BOOK_D = 0.31, BOOK_T = 0.032;
  const CLOSED_AT = { x: 0.47, z: 0.25 };          // desk frame: on the leather right of the blotter, clear of the phone, its cord and the pen cup
  const OPEN_AT = { x: 0.0, z: 0.24 };             // the blotter's centre (president_office.js L.open)
  const LEATHER_Y = 0.006, BLOTTER_TOP = LEATHER_Y + 0.008;
  const TURN_SECS = 0.42;

  let SRC = null;
  const B = {
    desk: null, closed: null, open: null, pages: { L: null, R: null }, leaf: null, leafF: null, leafB: null,
    cv: { L: null, R: null, F: null, Bk: null }, tex: {}, hits: { L: [], R: [] }, ids: { L: null, R: null },
    spread: 0, focus: 0, isOpen: false, ver: -1, turnT: -1, turnDir: 0, painted: 0, cine: false, fpsWas: false,
    tgt: null, wiredZone: false, cursor: null, padCur: { x: 0, y: 0, on: false },
  };
  function PO() { return CBZ.presidentOffice || null; }
  function canvas() { const c = document.createElement("canvas"); c.width = (CBZ.presPapers && CBZ.presPapers.PAGE_W) || 768; c.height = (CBZ.presPapers && CBZ.presPapers.PAGE_H) || 1024; return c; }
  function texOf(cv) {
    const t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    try { t.anisotropy = Math.min(8, CBZ.renderer.capabilities.getMaxAnisotropy()); } catch (e) { t.anisotropy = 4; }
    return t;
  }
  function flat(w, d, mat) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    return m;
  }
  function lam(hex) { return new THREE.MeshLambertMaterial({ color: hex }); }

  // ---- the cover: navy leather, a gold rule, the seal, the title
  function coverTex() {
    const c = document.createElement("canvas"); c.width = 256; c.height = 340;
    const x = c.getContext("2d");
    x.fillStyle = "#1b2438"; x.fillRect(0, 0, 256, 340);
    x.globalAlpha = 0.08; x.fillStyle = "#000";
    for (let i = 0; i < 300; i++) x.fillRect((i * 89) % 256, (i * 47) % 340, 2, 1);
    x.globalAlpha = 1;
    x.strokeStyle = "#b8954a"; x.lineWidth = 2; x.strokeRect(12, 12, 232, 316);
    x.strokeStyle = "#c9a457"; x.lineWidth = 3; x.beginPath(); x.arc(128, 120, 44, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 1.5; x.beginPath(); x.arc(128, 120, 36, 0, Math.PI * 2); x.stroke();
    x.fillStyle = "#c9a457"; x.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 8 : 20; x[i ? "lineTo" : "moveTo"](128 + Math.cos(a) * r, 120 + Math.sin(a) * r); }
    x.closePath(); x.fill();
    x.font = "bold 17px Georgia, serif"; x.textAlign = "center";
    x.fillText("THE PRESIDENT'S", 128, 214); x.fillText("DAILY BRIEF", 128, 238);
    x.font = "bold 11px 'Courier New', monospace"; x.fillText("TOP SECRET", 128, 300);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    return t;
  }

  function build() {
    const PO_ = PO();
    const desk = PO_ && PO_.deskFrame ? PO_.deskFrame() : null;
    if (!desk || !SRC) return false;
    if (B.desk === desk && B.closed && B.closed.parent === desk) return true;
    teardown();
    B.desk = desk;
    // CLOSED: the board, the page block, the cover's face
    const closed = new THREE.Group();
    closed.name = "pres-book-closed";
    const board = new THREE.Mesh(new THREE.BoxGeometry(BOOK_W, BOOK_T, BOOK_D), lam(0x1b2438));
    board.position.y = BOOK_T / 2; closed.add(board);
    const block = new THREE.Mesh(new THREE.BoxGeometry(BOOK_W - 0.012, BOOK_T - 0.008, BOOK_D - 0.01), lam(0xece6d4));
    block.position.set(0.004, BOOK_T / 2, 0); closed.add(block);
    const face = flat(BOOK_W - 0.006, BOOK_D - 0.006, new THREE.MeshLambertMaterial({ map: coverTex() }));
    face.position.y = BOOK_T + 0.0006; closed.add(face);
    closed.position.set(CLOSED_AT.x, LEATHER_Y, CLOSED_AT.z);
    closed.rotation.y = -0.06;
    desk.add(closed);
    B.closed = closed;
    // OPEN: the spread boards, the two pages, the leaf that turns
    const open = new THREE.Group();
    open.name = "pres-book-open";
    const boards = new THREE.Mesh(new THREE.BoxGeometry(BOOK_W * 2 + 0.004, 0.006, BOOK_D), lam(0x1b2438));
    boards.position.y = 0.003; open.add(boards);
    for (const s of [-1, 1]) {
      const stack = new THREE.Mesh(new THREE.BoxGeometry(PAGE_W + 0.004, 0.008, PAGE_H + 0.004), lam(0xe9e3d0));
      stack.position.set(s * (PAGE_W / 2 + GUTTER / 2), 0.006 + 0.004, 0); open.add(stack);
    }
    B.cv.L = canvas(); B.cv.R = canvas(); B.cv.F = canvas(); B.cv.Bk = canvas();
    for (const k of ["L", "R", "F", "Bk"]) B.tex[k] = texOf(B.cv[k]);
    const pageMat = function (k) { return new THREE.MeshBasicMaterial({ map: B.tex[k], toneMapped: false }); };
    const PY = 0.0145;
    B.pages.L = flat(PAGE_W, PAGE_H, pageMat("L")); B.pages.L.position.set(-(PAGE_W / 2 + GUTTER / 2), PY, 0); B.pages.L.userData.side = "L"; open.add(B.pages.L);
    B.pages.R = flat(PAGE_W, PAGE_H, pageMat("R")); B.pages.R.position.set(PAGE_W / 2 + GUTTER / 2, PY, 0); B.pages.R.userData.side = "R"; open.add(B.pages.R);
    // the leaf: hinged on the spine (local x = 0), its front the right-hand
    // page it was, its back the left-hand page it becomes
    const leaf = new THREE.Group(); leaf.position.y = PY + 0.0015; leaf.visible = false;
    B.leafF = flat(PAGE_W, PAGE_H, pageMat("F")); B.leafF.position.x = PAGE_W / 2 + GUTTER / 2; leaf.add(B.leafF);
    B.leafB = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_W, PAGE_H), pageMat("Bk"));
    B.leafB.rotation.x = Math.PI / 2; B.leafB.rotation.z = Math.PI; B.leafB.position.set(PAGE_W / 2 + GUTTER / 2, -0.0004, 0); leaf.add(B.leafB);
    open.add(leaf); B.leaf = leaf;
    open.position.set(OPEN_AT.x, BLOTTER_TOP, OPEN_AT.z);
    open.visible = false;
    desk.add(open);
    B.open = open;
    B.ver = -1;
    return true;
  }
  function teardown() {
    for (const k of ["closed", "open"]) {
      const o = B[k]; if (!o) continue;
      if (o.parent) o.parent.remove(o);
      o.traverse(function (m) { if (m.geometry) m.geometry.dispose(); if (m.material) { if (m.material.map) m.material.map.dispose(); m.material.dispose(); } });
      B[k] = null;
    }
    B.desk = null; B.leaf = null;
  }

  // ---- pages
  function ids() { return SRC ? SRC.pages() : []; }
  function spreads() { return Math.ceil(ids().length / 2); }
  function paintSide(side, idx, cvKey) {
    const list = ids(), cv = B.cv[cvKey || side], x = cv.getContext("2d");
    const id = list[idx];
    if (id == null) {
      // the inside of the back board
      x.fillStyle = "#1b2438"; x.fillRect(0, 0, cv.width, cv.height);
      x.strokeStyle = "#b8954a"; x.lineWidth = 3; x.strokeRect(24, 24, cv.width - 48, cv.height - 48);
      if (!cvKey || cvKey === side) { B.hits[side] = []; B.ids[side] = null; }
    } else {
      const hits = SRC.paint(x, id) || [];
      corner(x, cv, side === "R" || cvKey === "F");
      if (!cvKey || cvKey === side) { B.hits[side] = hits; B.ids[side] = id; }
    }
    B.tex[cvKey || side].needsUpdate = true;
  }
  // the curled corner you turn a page by (bottom outer corner)
  const CORNER = 64;
  function corner(x, cv, right) {
    const W = cv.width, H = cv.height, s = CORNER;
    x.save();
    x.fillStyle = "rgba(0,0,0,0.10)";
    x.beginPath();
    if (right) { x.moveTo(W, H - s); x.lineTo(W - s, H); x.lineTo(W, H); }
    else { x.moveTo(0, H - s); x.lineTo(s, H); x.lineTo(0, H); }
    x.closePath(); x.fill();
    x.fillStyle = "#e6dfcb"; x.strokeStyle = "rgba(0,0,0,0.25)"; x.lineWidth = 1.5;
    x.beginPath();
    if (right) { x.moveTo(W, H - s); x.lineTo(W - s, H); x.lineTo(W - s * 0.9, H - s * 0.9); }
    else { x.moveTo(0, H - s); x.lineTo(s, H); x.lineTo(s * 0.9, H - s * 0.9); }
    x.closePath(); x.fill(); x.stroke();
    x.restore();
  }
  function paintSpread() {
    paintSide("L", B.spread * 2);
    paintSide("R", B.spread * 2 + 1);
    B.ver = SRC && SRC.version ? SRC.version() : 0;
  }

  // ---- reading: the camera over the open book
  function single() { const c = CBZ.camera; return !!(c && c.aspect < 1.05); }
  function deskWorld(lx, ly, lz) {
    const v = new THREE.Vector3(lx, ly, lz);
    B.desk.updateMatrixWorld(true);
    return B.desk.localToWorld(v);
  }
  function framePose() {
    const cam = CBZ.camera;
    const vfov = (cam.fov || 60) * Math.PI / 180, asp = cam.aspect || 1.6, t2 = 2 * Math.tan(vfov / 2);
    const one = single();
    const w = one ? PAGE_W : PAGE_W * 2 + GUTTER, d = PAGE_H;
    const h = Math.max(d / 0.9, w / (0.92 * asp)) / t2;
    const cx = OPEN_AT.x + (one ? (B.focus === 0 ? -1 : 1) * (PAGE_W / 2 + GUTTER / 2) : 0);
    const tilt = 0.16;                                 // a little from the chair's side, as a man leans over a book
    const look = deskWorld(cx, BLOTTER_TOP + 0.015, OPEN_AT.z);
    const eye = deskWorld(cx, BLOTTER_TOP + 0.015 + h * Math.cos(tilt), OPEN_AT.z + h * Math.sin(tilt));
    return { eye: eye, look: look };
  }
  function holdCamera(cut) {
    if (!CBZ.cinePlay) return;
    const p = framePose();
    // whoever held the lens (ours from the last page, or a scene that was
    // ending) lets go first: the book is what he is looking at now
    if (CBZ.cineAbort && (B.cine || (CBZ.cineBusy && CBZ.cineBusy()))) { B.cine = false; try { CBZ.cineAbort(); } catch (e) {} }
    let ok = false;
    try {
      ok = CBZ.cinePlay([{ cam: { pos: { x: p.eye.x, y: p.eye.y, z: p.eye.z }, look: { x: p.look.x, y: p.look.y, z: p.look.z } }, dur: 1e9, cut: !!cut }], {}, function () {
        // the scene ended from outside (death, a cut): the book is put down
        if (B.cine) { B.cine = false; if (B.isOpen) close(true); }
      }, { keepBody: true }) !== false;
    } catch (e) { ok = false; }
    B.cine = ok;
  }
  let lastAspect = 0;
  function open() {
    if (B.isOpen || !SRC || !build()) return false;
    const PO_ = PO();
    if (PO_ && PO_.busy && PO_.busy()) return false;           // a folder open, a call, somebody at the desk
    B.isOpen = true; CBZ.presBookOpen = true;
    document.documentElement.classList.add("pres-reading");
    B.closed.visible = false; B.open.visible = true;
    B.focus = 0;
    paintSpread();
    B.fpsWas = !!(CBZ.fpsActive && CBZ.fpsActive());
    holdCamera(true);                  // he looks down at it: a cut, not a swoop through his own head
    lastAspect = CBZ.camera ? CBZ.camera.aspect : 0;
    // the mouse is the reader's hand: let it go so it can point at the page
    if (document.pointerLockElement && document.exitPointerLock && !CBZ.touchMode) { try { document.exitPointerLock(); } catch (e) {} }
    if (CBZ.sfx) { try { CBZ.sfx("pickup", { vol: 0.35 }); } catch (e) {} }
    return true;
  }
  function close(fromScene) {
    if (!B.isOpen) return;
    B.isOpen = false; CBZ.presBookOpen = false;
    document.documentElement.classList.remove("pres-reading");
    B.turnT = -1; if (B.leaf) B.leaf.visible = false;
    if (B.open) B.open.visible = false;
    if (B.closed) B.closed.visible = true;
    if (!fromScene && B.cine && CBZ.cineAbort) { B.cine = false; try { CBZ.cineAbort(); } catch (e) {} }
    B.cine = false;
    if (B.fpsWas && CBZ.setFPS) { try { CBZ.setFPS(true); } catch (e) {} }
    setCursor(""); padCursor(false);
    if (CBZ.sfx) { try { CBZ.sfx("pickup", { vol: 0.25 }); } catch (e) {} }
  }

  // ---- turning
  function turn(dir) {
    if (!B.isOpen || B.turnT >= 0) return false;
    const n = spreads();
    if (single()) {
      // one page at a time: inside a spread the eye moves; across it the leaf turns
      if (dir > 0 && B.focus === 0 && ids()[B.spread * 2 + 1] != null) { B.focus = 1; holdCamera(); return true; }
      if (dir < 0 && B.focus === 1) { B.focus = 0; holdCamera(); return true; }
    }
    const to = B.spread + dir;
    if (to < 0 || to >= n) return false;
    if (dir > 0) {
      paintSide("R", B.spread * 2 + 1, "F");         // the leaf's front: the page being turned
      paintSide("L", to * 2, "Bk");                  // its back: the next left page
      paintSide("R", to * 2 + 1);                    // under it: the next right page
    } else {
      paintSide("L", B.spread * 2, "Bk");
      paintSide("R", to * 2 + 1, "F");
      paintSide("L", to * 2);
    }
    B.turnFrom = B.spread; B.spread = to; B.turnDir = dir; B.turnT = 0;
    B.leaf.visible = true;
    B.leaf.rotation.z = dir > 0 ? 0 : Math.PI;
    if (single()) B.focus = dir > 0 ? 0 : 1;
    if (CBZ.sfx) { try { CBZ.sfx("paper", { vol: 0.3 }); } catch (e) { try { CBZ.sfx("pickup", { vol: 0.18 }); } catch (e2) {} } }
    if (single()) holdCamera();
    return true;
  }
  function tickTurn(dt) {
    if (B.turnT < 0 || !B.leaf) return;
    B.turnT += dt / TURN_SECS;
    const t = Math.min(1, B.turnT), e = t * t * (3 - 2 * t);
    // over the spine: 0 (lying right) -> PI (lying left), lifted in the middle
    B.leaf.rotation.z = B.turnDir > 0 ? e * Math.PI : (1 - e) * Math.PI;
    if (t >= 1) {
      B.turnT = -1; B.leaf.visible = false;
      paintSpread();
    }
  }

  // ---- the finger on the page
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pickPage(cx, cy) {
    const el = CBZ.renderer && CBZ.renderer.domElement;
    if (!el || !B.open) return null;
    const r = el.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    CBZ.camera.updateMatrixWorld();
    ray.setFromCamera(ndc, CBZ.camera);
    const hs = ray.intersectObjects([B.pages.L, B.pages.R], false);
    if (!hs.length || !hs[0].uv) return null;
    const side = hs[0].object.userData.side, cv = B.cv[side];
    return { side: side, x: hs[0].uv.x * cv.width, y: (1 - hs[0].uv.y) * cv.height };
  }
  function tapPage(p) {
    if (!p) { close(); return; }
    const cv = B.cv[p.side], W = cv.width, H = cv.height;
    // the curled corner
    if (p.y > H - CORNER * 1.4 && (p.side === "R" ? p.x > W - CORNER * 1.4 : p.x < CORNER * 1.4)) { turn(p.side === "R" ? 1 : -1); return; }
    const h = CBZ.presPapers ? CBZ.presPapers.hit(B.hits[p.side], p.x, p.y) : null;
    if (!h || !SRC) return;
    flash(p.side, h);
    let again = true;
    try { again = SRC.press(h, p.x, p.y, B.ids[p.side]) !== false; } catch (e) { console.warn("[presBook] press", e); }
    if (again) setTimeout(function () { if (B.isOpen && B.turnT < 0) paintSpread(); }, 160);
    if (h.go) {            // a box that opens another page (the world page's countries)
      const at = ids().indexOf(h.go);
      if (at >= 0) setTimeout(function () { goTo(at); }, 180);
    }
  }
  function goTo(pageIdx) {
    const s = Math.floor(pageIdx / 2);
    if (s === B.spread) { if (single()) { B.focus = pageIdx % 2; holdCamera(); } return; }
    const dir = s > B.spread ? 1 : -1;
    B.spread = s - dir;                              // one turn lands on it
    turn(dir);
    if (single()) { B.focus = pageIdx % 2; }
  }
  // the box you pressed darkens for a beat
  function flash(side, h) {
    const x = B.cv[side].getContext("2d");
    x.save(); x.fillStyle = "rgba(31,63,122,0.30)"; x.fillRect(h.x, h.y, h.w, h.h); x.restore();
    B.tex[side].needsUpdate = true;
  }
  function setCursor(c) { const el = CBZ.renderer && CBZ.renderer.domElement; if (el) el.style.cursor = c; }

  // pointer, keys, pad: while the book is open they are the book's
  const ptr = { id: null, x0: 0, y0: 0, t0: 0, moved: 0 };
  function onDown(e) {
    if (!B.isOpen) return;
    if (e.target !== (CBZ.renderer && CBZ.renderer.domElement)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    ptr.id = e.pointerId; ptr.x0 = e.clientX; ptr.y0 = e.clientY; ptr.t0 = performance.now(); ptr.moved = 0;
  }
  function onMove(e) {
    if (!B.isOpen) return;
    if (ptr.id === e.pointerId) { ptr.moved = Math.max(ptr.moved, Math.hypot(e.clientX - ptr.x0, e.clientY - ptr.y0)); e.stopImmediatePropagation(); return; }
    if (e.pointerType === "mouse") {
      const p = pickPage(e.clientX, e.clientY);
      const over = p && (CBZ.presPapers.hit(B.hits[p.side], p.x, p.y) || (p.y > B.cv[p.side].height - CORNER * 1.4));
      setCursor(over ? "pointer" : "");
    }
  }
  function onUp(e) {
    if (!B.isOpen || ptr.id !== e.pointerId) return;
    e.preventDefault(); e.stopImmediatePropagation();
    ptr.id = null;
    const dx = e.clientX - ptr.x0;
    if (ptr.moved > 40 && Math.abs(dx) > 50) { turn(dx < 0 ? 1 : -1); return; }      // a swipe
    if (ptr.moved < 14) tapPage(pickPage(e.clientX, e.clientY));
  }
  function swallow(e) { if (B.isOpen && e.target === (CBZ.renderer && CBZ.renderer.domElement)) { e.preventDefault(); e.stopImmediatePropagation(); } }
  addEventListener("pointerdown", onDown, true);
  addEventListener("pointermove", onMove, true);
  addEventListener("pointerup", onUp, true);
  for (const t of ["mousedown", "mouseup", "click", "touchstart", "touchend", "contextmenu"]) addEventListener(t, swallow, { capture: true, passive: false });
  addEventListener("keydown", function (e) {
    if (!B.isOpen) return;
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    const k = String(e.key || "").toLowerCase(), code = e.code || "";
    const eat = function () { e.preventDefault(); e.stopImmediatePropagation(); };
    if (k === "arrowright" || code === "KeyD" || k === "pagedown") { eat(); if (!e.repeat) turn(1); return; }
    if (k === "arrowleft" || code === "KeyA" || k === "pageup") { eat(); if (!e.repeat) turn(-1); return; }
    if (k === "escape" || code === "KeyE" || code === "KeyQ" || k === "backspace") { eat(); if (!e.repeat) close(); return; }
    // nothing else moves you while you read
    if (/^Key[WSFRCVX]$|^Space$|^Arrow|^Digit|^Tab$/.test(code)) eat();
  }, true);

  // THE CONTROLLER (systems/gamepad.js CBZ.padOwner): while the book is open
  // the pad drives the book and nothing else
  function padCursor(on) {
    if (!on) { B.padCur.on = false; if (B.cursor) B.cursor.style.display = "none"; return; }
    if (!B.cursor) {
      B.cursor = document.createElement("div");
      B.cursor.style.cssText = "position:fixed;left:0;top:0;width:16px;height:16px;margin:-8px 0 0 -8px;border:2px solid #1f3f7a;border-radius:50%;background:rgba(31,63,122,.15);pointer-events:none;z-index:2147483000;display:none";
      document.body.appendChild(B.cursor);
    }
    if (!B.padCur.on) { B.padCur.on = true; B.padCur.x = innerWidth / 2; B.padCur.y = innerHeight / 2; }
    B.cursor.style.display = "block";
    B.cursor.style.transform = "translate(" + B.padCur.x.toFixed(0) + "px," + B.padCur.y.toFixed(0) + "px)";
  }
  CBZ.padOwner = {
    active: function () { return B.isOpen; },
    pad: function (pad, edge, BTN) {
      if (edge(BTN.DRIGHT) || edge(BTN.RB)) turn(1);
      if (edge(BTN.DLEFT) || edge(BTN.LB)) turn(-1);
      if (edge(BTN.B)) { close(); return; }
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      if (Math.abs(ax) > 0.2 || Math.abs(ay) > 0.2 || B.padCur.on) {
        B.padCur.x = Math.max(0, Math.min(innerWidth, B.padCur.x + (Math.abs(ax) > 0.2 ? ax : 0) * 14));
        B.padCur.y = Math.max(0, Math.min(innerHeight, B.padCur.y + (Math.abs(ay) > 0.2 ? ay : 0) * 14));
        padCursor(true);
      }
      if (edge(BTN.A)) tapPage(pickPage(B.padCur.on ? B.padCur.x : innerWidth / 2, B.padCur.on ? B.padCur.y : innerHeight / 2));
    },
  };

  // ---- E (or a tap) on the closed book: Read
  function wireZone() {
    if (B.wiredZone || !CBZ.interactions || !CBZ.interactions.registerFixtures) return;
    B.wiredZone = true;
    CBZ.interactions.registerFixtures({
      id: "presbook", kind: "presbook", prio: 17,
      reach: function () { return 2.4; },
      dot: function () { return 0.3; },
      list: function () {
        if (!SRC || !B.closed || !B.closed.visible || B.isOpen) return null;
        const P = CBZ.player;
        if (!P || !P.pos) return null;
        const w = deskWorld(CLOSED_AT.x, LEATHER_Y + BOOK_T, CLOSED_AT.z);
        if (Math.abs(P.pos.y - w.y) > 2.4) return null;
        B.tgt = { x: w.x, y: w.y, z: w.z, ay: w.y, ar: 0.13, kind: "presbook" };
        return [B.tgt];
      },
      name: function () { return ""; },
      verbs: [{
        id: "presbook-read", slot: "e", prio: 23, campaignSafe: true,
        label: "Read",
        canShow: function () { const p = PO(); return !B.isOpen && !(p && p.busy && p.busy()); },
        onSelect: function () { open(); },
      }],
    });
  }

  // ---- the tick
  let verAcc = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(38.9, function (dt) {
    if (g.mode !== "city" || !SRC) { if (B.isOpen) close(); return; }
    dt = Math.min(0.1, dt || 0);
    wireZone();
    build();
    if (!B.isOpen) return;
    tickTurn(dt);
    // the day changed, an order landed: what is on the open pages is redrawn
    verAcc += dt;
    if (verAcc > 0.5 && B.turnT < 0) {
      verAcc = 0;
      const v = SRC.version ? SRC.version() : 0;
      if (v !== B.ver) paintSpread();
    }
    // the screen turned (a phone rotated): frame the book again
    if (CBZ.camera && Math.abs(CBZ.camera.aspect - lastAspect) > 0.05) { lastAspect = CBZ.camera.aspect; holdCamera(); }
    // a book cannot be read standing across the room or in a gunfight
    const P = CBZ.player;
    if (!P || P.dead || g.state !== "playing") close();
  });

  CBZ.presBook = {
    setSource: function (src) { SRC = src || null; if (!SRC) { close(); teardown(); } },
    open: open, close: close, isOpen: function () { return B.isOpen; }, turn: turn, goTo: goTo,
    audit: function () {
      return { built: !!B.closed, open: B.isOpen, spread: B.spread, focus: B.focus, single: single(), pages: ids(), left: B.ids.L, right: B.ids.R,
        hitsL: B.hits.L.length, hitsR: B.hits.R.length, turning: B.turnT >= 0,
        closedAt: B.closed && B.desk ? deskWorld(CLOSED_AT.x, LEATHER_Y + BOOK_T, CLOSED_AT.z) : null };
    },
    // the desk-frame footprints the overlap census measures (tools/president-desk-census.mjs)
    footprint: function () {
      return [
        { name: "briefing book (closed)", x: CLOSED_AT.x, z: CLOSED_AT.z, w: BOOK_W, d: BOOK_D, y0: LEATHER_Y, y1: LEATHER_Y + BOOK_T, ry: -0.06, when: "closed" },
        { name: "briefing book (open)", x: OPEN_AT.x, z: OPEN_AT.z, w: BOOK_W * 2 + 0.004, d: BOOK_D, y0: BLOTTER_TOP, y1: BLOTTER_TOP + 0.016, ry: 0, when: "open" },
      ];
    },
    _tapPage: function (side, x, y) { tapPage({ side: side, x: x, y: y }); },
    _build: function () { return build(); }, _groups: function () { return { closed: B.closed, open: B.open }; },
  };
  CBZ.presBookOpen = false;
  // while he reads, nothing of the game's own furniture sits on the page
  // (the map in the corner, the money, the bar of things he carries)
  (function () {
    const st = document.createElement("style");
    st.textContent = "html.pres-reading #cityHud, html.pres-reading #hotbar { visibility: hidden !important; }";
    const host = document.head || document.documentElement || document.body;
    if (host && host.appendChild) host.appendChild(st);
  })();
})();
