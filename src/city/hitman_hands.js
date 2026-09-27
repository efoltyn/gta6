/* ============================================================
   city/hitman_hands.js — WHAT THE HITMAN DOES WITH HIS HANDS AND EYES.

   OWNER (2026-09-27): "Stop breaking the fourth wall." No panels that name
   systems, no "press X to read" menus. So the verbs of the hitman's life are
   physical, and this file is the small kit every other hitman file uses:

     CBZ.hmHold       hold a paper up to your eyes (a folder, a newspaper, a
                      cable). A real plane in front of the camera; you can
                      still walk and look while you read it.
     CBZ.hmVerbs      the ONLY prompt: one verb for the thing in front of you,
                      "E  Answer". No title, no card. A tappable pill on touch.
     CBZ.hmInspect    lean in and look at a thing (the corkboard, the open gun
                      case, the TV): the camera eases in through CBZ.cineCam.
     CBZ.hmSay/hmCall a line said by someone: over his head, or by your hand
                      on the phone (CBZ.speech). Never a subtitle box.
     CBZ.hmBinoculars hold Option/Alt: binoculars. First person, a long lens, a
                      two-circle mask. Scouting is looking.

   Alt is the binocular key because it is the one key nothing in src/ binds
   (every letter is taken by some system; see the survey in the wave notes).
   Zero per-frame cost when nothing is held, inspected or offered.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.game || typeof document === "undefined") return;
  const g = CBZ.game;

  function playing() { return g.mode === "city" && g.state === "playing"; }
  function touch() { return !!CBZ.touchMode; }
  function P() { return CBZ.player || null; }
  function now() { return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000; }
  function clean(s) { return String(s == null ? "" : s).replace(/[—–]/g, ", ").replace(/[·•]/g, ","); }

  /* ---------------- one stylesheet ---------------- */
  const CSS = [
    ".hm-verb{position:fixed;left:50%;bottom:calc(19vh + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:48;",
    "display:none;align-items:center;gap:10px;padding:6px 14px 6px 8px;color:#f3efe6;font:500 17px/1.2 'Helvetica Neue',Helvetica,Arial,sans-serif;",
    "letter-spacing:.02em;text-shadow:0 1px 3px rgba(0,0,0,.9),0 0 12px rgba(0,0,0,.6);pointer-events:none;white-space:nowrap;}",
    ".hm-verb.hm-on{display:flex;}",
    ".hm-key{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 6px;box-sizing:border-box;",
    "border:1.5px solid rgba(243,239,230,.85);border-radius:5px;font:700 14px/1 'Helvetica Neue',Helvetica,Arial,sans-serif;text-shadow:none;",
    "background:rgba(0,0,0,.35);}",
    ".hm-verb.hm-touch{pointer-events:auto;cursor:pointer;background:rgba(10,10,12,.55);border-radius:22px;padding:10px 20px;min-height:44px;box-sizing:border-box;",
    "-webkit-tap-highlight-color:transparent;touch-action:manipulation;}",
    ".hm-verb.hm-touch .hm-key{display:none;}",
    ".hm-bino{position:fixed;inset:0;z-index:46;pointer-events:none;display:none;}",
    ".hm-bino.hm-on{display:block;}",
    ".hm-bino i{position:absolute;inset:0;background:#030303;",
    "-webkit-mask-image:radial-gradient(circle at 37% 50%,transparent 0 23.5vmin,#000 25.5vmin),radial-gradient(circle at 63% 50%,transparent 0 23.5vmin,#000 25.5vmin);",
    "mask-image:radial-gradient(circle at 37% 50%,transparent 0 23.5vmin,#000 25.5vmin),radial-gradient(circle at 63% 50%,transparent 0 23.5vmin,#000 25.5vmin);",
    "-webkit-mask-composite:source-in;mask-composite:intersect;}",
    ".hm-bino u{position:absolute;left:50%;bottom:22vh;transform:translateX(-50%);color:rgba(200,255,210,.65);font:600 13px/1 'Courier New',monospace;",
    "letter-spacing:.2em;text-decoration:none;text-shadow:0 0 4px rgba(0,0,0,.9);}",
    ".hm-binobtn{position:fixed;right:14px;top:calc(150px + env(safe-area-inset-top));z-index:44;width:48px;height:44px;display:none;border:0;border-radius:10px;",
    "background:rgba(12,12,14,.5);color:#e9e4d8;font:600 12px/44px 'Helvetica Neue',Arial,sans-serif;-webkit-tap-highlight-color:transparent;touch-action:manipulation;padding:0;}",
    ".hm-binobtn.hm-on{display:block;}",
    ".hm-binobtn svg{width:30px;height:22px;vertical-align:middle;}",
    ".hm-fade{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:69;transition:opacity .6s ease;}",
  ].join("");
  let dom = null;
  function ensureDom() {
    if (dom) return dom;
    if (!document.body) return null;
    const st = document.createElement("style"); st.id = "hitmanHandsCss"; st.textContent = CSS;
    (document.head || document.body).appendChild(st);
    dom = {};
    dom.verb = document.createElement("div"); dom.verb.className = "hm-verb";
    dom.key = document.createElement("span"); dom.key.className = "hm-key";
    dom.vtext = document.createElement("span");
    dom.verb.appendChild(dom.key); dom.verb.appendChild(dom.vtext);
    const tapVerb = function (e) { e.preventDefault(); e.stopPropagation(); useVerb(); };
    dom.verb.addEventListener("touchend", tapVerb, { passive: false });
    dom.verb.addEventListener("click", tapVerb);
    document.body.appendChild(dom.verb);
    dom.bino = document.createElement("div"); dom.bino.className = "hm-bino";
    dom.bino.appendChild(document.createElement("i"));
    dom.range = document.createElement("u"); dom.bino.appendChild(dom.range);
    document.body.appendChild(dom.bino);
    dom.binoBtn = document.createElement("button"); dom.binoBtn.type = "button"; dom.binoBtn.className = "hm-binobtn";
    dom.binoBtn.setAttribute("aria-label", "Binoculars");
    dom.binoBtn.innerHTML = '<svg viewBox="0 0 30 22"><circle cx="8" cy="13" r="7" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="22" cy="13" r="7" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 8h6" stroke="currentColor" stroke-width="2.4"/></svg>';
    dom.binoBtn.addEventListener("touchend", function (e) { e.preventDefault(); e.stopPropagation(); bino.toggle(!bino.on); }, { passive: false });
    dom.binoBtn.addEventListener("click", function (e) { e.stopPropagation(); bino.toggle(!bino.on); });
    document.body.appendChild(dom.binoBtn);
    dom.fade = document.createElement("div"); dom.fade.className = "hm-fade";
    document.body.appendChild(dom.fade);
    return dom;
  }

  /* ================================================================
     HOLD — a paper in front of your eyes
     ================================================================ */
  const H = { mesh: null, tex: null, canvas: null, kind: null, onClose: null, t: 0, out: false, openedAt: 0 };
  function texFor(c) {
    const t = new THREE.CanvasTexture(c);
    const R = CBZ.renderer;
    if (R && R.outputEncoding === THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    try { t.anisotropy = R && R.capabilities ? Math.min(8, R.capabilities.getMaxAnisotropy()) : 4; } catch (e) {}
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    return t;
  }
  function ensureMesh() {
    if (H.mesh) return H.mesh;
    const m = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
    m.toneMapped = false;
    H.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    H.mesh.renderOrder = 9990;
    H.mesh.frustumCulled = false;
    H.mesh.visible = false;
    return H.mesh;
  }
  function hold(canvas, opts) {
    opts = opts || {};
    if (!canvas || !CBZ.camera) return false;
    const cam = CBZ.camera;
    if (!cam.parent && CBZ.scene) CBZ.scene.add(cam);
    const m = ensureMesh();
    if (m.parent !== cam) cam.add(m);
    if (H.canvas && H.canvas !== canvas && H.onClose) { const f = H.onClose; H.onClose = null; try { f(); } catch (e) {} }
    if (H.tex && H.canvas !== canvas) { H.tex.dispose(); H.tex = null; }
    if (!H.tex) H.tex = texFor(canvas);
    H.tex.needsUpdate = true;
    m.material.map = H.tex; m.material.needsUpdate = true;
    H.canvas = canvas; H.kind = opts.kind || "paper"; H.onClose = opts.onClose || null;
    H.out = false; H.t = 0; H.openedAt = now();
    m.visible = true;
    bino.toggle(false);
    placeHeld(0);
    if (CBZ.sfx) { try { CBZ.sfx("pickup"); } catch (e) {} }
    return true;
  }
  function holdUpdate(canvas) {
    if (!H.mesh || !H.mesh.visible) return;
    if (canvas && canvas !== H.canvas) { hold(canvas, { kind: H.kind, onClose: H.onClose }); return; }
    if (H.tex) H.tex.needsUpdate = true;
  }
  function holdClose() {
    if (!H.mesh || !H.mesh.visible || H.out) return;
    H.out = true; H.t = 0;
  }
  function holdFinish() {
    if (H.mesh) H.mesh.visible = false;
    const f = H.onClose; H.onClose = null; H.canvas = null; H.out = false;
    if (f) { try { f(); } catch (e) {} }
  }
  function placeHeld(k) {
    // size the sheet to fit the view at distance d, whatever the fov / aspect
    const cam = CBZ.camera; const m = H.mesh; if (!cam || !m || !H.canvas) return;
    const d = Math.max(0.45, (cam.near || 0.1) * 3);
    const vh = 2 * d * Math.tan((cam.fov || 60) * Math.PI / 360);
    const vw = vh * (cam.aspect || 1.6);
    const ar = H.canvas.width / H.canvas.height;
    const fill = H.kind === "folder" ? 0.96 : 0.9;
    let w = vw * fill, h = w / ar;
    if (h > vh * fill) { h = vh * fill; w = h * ar; }
    m.scale.set(w, h, 1);
    // ease up from below, a breath of sway, a slight tilt like held paper
    const e = 1 - Math.pow(1 - Math.min(1, k), 3);
    const t = now();
    const sway = 0.004 * vh;
    m.position.set(Math.sin(t * 0.9) * sway, -vh * (1 - e) * 1.1 + Math.sin(t * 1.3) * sway * 0.7 - vh * 0.01, -d);
    m.rotation.set(-0.06 * (1 - e) - 0.02, 0, Math.sin(t * 0.7) * 0.006 + (H.kind === "news" ? -0.012 : 0.004));
  }
  function tickHold(dt) {
    if (!H.mesh || !H.mesh.visible) return;
    if (!playing() || (P() && P().dead)) { holdFinish(); return; }
    H.t += dt;
    if (H.out) {
      const k = 1 - Math.min(1, H.t / 0.22);
      placeHeld(k);
      if (H.t >= 0.22) holdFinish();
      return;
    }
    placeHeld(Math.min(1, H.t / 0.32));
  }
  CBZ.hmHold = {
    open: hold, update: holdUpdate, close: holdClose,
    isOpen: function () { return !!(H.mesh && H.mesh.visible && !H.out); },
    kind: function () { return H.mesh && H.mesh.visible ? H.kind : null; },
    canvas: function () { return H.canvas; },
  };

  /* ================================================================
     VERBS — the only prompt
     ================================================================ */
  const V = { list: [], cur: null, tok: null, text: "", evalT: 0, inspectVerb: null };
  const _dir = new THREE.Vector3();
  function addVerb(def) {
    if (!def || !def.id) return;
    removeVerb(def.id);
    V.list.push(def);
  }
  function removeVerb(id) {
    for (let i = V.list.length - 1; i >= 0; i--) if (V.list[i].id === id) V.list.splice(i, 1);
    if (V.cur && V.cur.id === id) { V.cur = null; V.tok = null; }
  }
  function inFront(tok, px, pz) {
    if (tok.x == null) return true;
    const dx = tok.x - px, dz = tok.z - pz, d = Math.hypot(dx, dz);
    if (d < 1.1) return true;
    const cam = CBZ.camera; if (!cam) return true;
    cam.getWorldDirection(_dir);
    const fm = Math.hypot(_dir.x, _dir.z) || 1;
    return (dx * _dir.x + dz * _dir.z) / (d * fm) > 0.35;
  }
  function evalVerbs() {
    const pl = P();
    let best = null, bestTok = null, bestScore = -Infinity;
    const blocked = !playing() || !pl || !pl.pos || pl.dead || pl.driving || CBZ.cityMenuOpen ||
      (CBZ.fullMap && CBZ.fullMap.active) || CBZ.hmHold.isOpen() || I.active || bino.on || (CBZ.cineBusy && CBZ.cineBusy());
    if (!blocked) {
      for (let i = 0; i < V.list.length; i++) {
        const d = V.list[i];
        let tok = null;
        try { tok = d.find(pl.pos.x, pl.pos.z, pl); } catch (e) { tok = null; }
        if (!tok || !inFront(tok, pl.pos.x, pl.pos.z)) continue;
        const dist = tok.x != null ? Math.hypot(tok.x - pl.pos.x, tok.z - pl.pos.z) : 0;
        const score = (d.prio || 0) * 100 - dist;
        if (score > bestScore) { bestScore = score; best = d; bestTok = tok; }
      }
    }
    V.cur = best; V.tok = bestTok;
    let text = "";
    if (best) { try { text = typeof best.verb === "function" ? best.verb(bestTok) : best.verb; } catch (e) { text = ""; } }
    if (!text) { V.cur = null; V.tok = null; }
    showVerb(text);
  }
  function showVerb(text, key) {
    const D = ensureDom(); if (!D) return;
    text = clean(text || "");
    if (text === V.text && D.verb.classList.contains("hm-on") === !!text) return;
    V.text = text;
    if (!text) { D.verb.classList.remove("hm-on"); return; }
    D.key.textContent = key || "E";
    D.vtext.textContent = text;
    D.verb.classList.toggle("hm-touch", touch());
    D.verb.classList.add("hm-on");
  }
  function useVerb() {
    if (I.active) { inspectUse(); return true; }
    if (!V.cur) return false;
    const d = V.cur, tok = V.tok;
    V.cur = null; V.tok = null; showVerb("");
    try { d.onUse(tok); } catch (e) { if (window.console) console.error("[hmVerbs]", e); }
    V.evalT = 0.25;
    return true;
  }
  CBZ.hmVerbs = { add: addVerb, remove: removeVerb, current: function () { return V.cur ? { id: V.cur.id, verb: V.text } : null; }, use: useVerb };

  /* ================================================================
     INSPECT — lean in and look
     ================================================================ */
  const I = { active: false, o: null, i: 0, prevRig: true, t: 0, swipe: null };
  function camChannel() { return CBZ.cineCam || null; }
  function inspectEnter(o) {
    const cc = camChannel();
    if (!cc || !o || I.active) return false;
    if (CBZ.cineBusy && CBZ.cineBusy()) return false;
    bino.toggle(false);
    if (CBZ.hmHold.isOpen()) holdClose();
    I.active = true; I.o = o; I.t = 0;
    I.i = Math.max(0, Math.min((o.stops || []).length - 1, o.index | 0));
    cc.active = true; cc.snap = false;
    aimStop();
    I.prevRig = !!(CBZ.playerChar && CBZ.playerChar.group && CBZ.playerChar.group.visible);
    showVerb("");
    return true;
  }
  function aimStop() {
    const cc = camChannel(); if (!cc || !I.o) return;
    const s = I.o.stops && I.o.stops.length ? I.o.stops[I.i] : I.o;
    const pos = s.pos || I.o.pos, look = s.look || I.o.look;
    if (!pos || !look) return;
    cc.x = pos.x; cc.y = pos.y; cc.z = pos.z; cc.lx = look.x; cc.ly = look.y; cc.lz = look.z;
    if (I.o.onStop && I.o.stops && I.o.stops.length) { try { I.o.onStop(I.i); } catch (e) {} }
    inspectVerbShow();
  }
  function inspectVerbShow() {
    const vs = I.o && I.o.verbs;
    let txt = "";
    if (vs && vs.length) { const v = vs[0]; try { txt = typeof v.verb === "function" ? v.verb(I.i) : v.verb; } catch (e) { txt = ""; } }
    I.verbText = txt;
    showVerb(txt, vs && vs[0] && vs[0].key);
  }
  function inspectStop(i) {
    if (!I.active || !I.o || !I.o.stops || !I.o.stops.length) return;
    const n = I.o.stops.length;
    I.i = ((i % n) + n) % n;
    aimStop();
    if (CBZ.sfx) { try { CBZ.sfx("pickup"); } catch (e) {} }
  }
  function inspectUse() {
    const vs = I.o && I.o.verbs;
    if (vs && vs.length && I.verbText) { try { vs[0].onUse(I.i); } catch (e) { if (window.console) console.error("[hmInspect]", e); } inspectVerbShow(); return; }
    inspectExit();
  }
  function inspectExit(silent) {
    if (!I.active) return;
    I.active = false;
    const cc = camChannel();
    if (cc && !(CBZ.cineBusy && CBZ.cineBusy())) cc.active = false;
    if (CBZ.playerChar && CBZ.playerChar.group && !(P() && P().dead)) CBZ.playerChar.group.visible = true;
    const o = I.o; I.o = null;
    showVerb("");
    if (!silent && o && o.onExit) { try { o.onExit(); } catch (e) {} }
  }
  function tickInspect(dt) {
    if (!I.active) return;
    const pl = P();
    if (!playing() || !pl || pl.dead) { inspectExit(); return; }
    if (CBZ.cineBusy && CBZ.cineBusy()) { I.active = false; I.o = null; showVerb(""); return; }
    const cc = camChannel(); if (cc && !cc.active) cc.active = true;
    I.t += dt;
    // the body would stand in the lens a foot from the cork: out of frame
    if (CBZ.playerChar && CBZ.playerChar.group && I.t > 0.15) CBZ.playerChar.group.visible = false;
  }
  CBZ.hmInspect = {
    enter: inspectEnter, exit: function () { inspectExit(); }, stop: inspectStop,
    active: function () { return I.active; }, index: function () { return I.i; },
    refreshVerb: function () { if (I.active) inspectVerbShow(); },
  };

  /* ================================================================
     SPOKEN LINES + CALLS
     No subtitle box. A line is said by someone: over his head when he is
     standing there (`by` = the ped), by your hand when he is on the phone
     (`by` = "phone"). Nobody to say it, nothing shown. Long authored lines
     are cut into breath-sized pieces (CBZ.speech keeps a line short and
     would otherwise drop the tail) and played one after another.
     ================================================================ */
  // the implementation lives in systems/speech.js (CBZ.speech.lines/pieces/then)
  function say(by, line) { return CBZ.speech ? CBZ.speech.lines([{ by: by, line: line }], null) : null; }
  function sayClear() { if (CBZ.speech) CBZ.speech.stopAll(); }
  function call(lines, onEnd) { return CBZ.speech ? CBZ.speech.lines(lines, onEnd) : (onEnd && onEnd(), null); }
  CBZ.hmSay = say; CBZ.hmSayClear = sayClear; CBZ.hmCall = call;
  CBZ.hmPieces = function (t) { return CBZ.speech ? CBZ.speech.pieces(t) : [String(t || "")]; };
  CBZ.sayLines = call; CBZ.speechPieces = CBZ.hmPieces;
  CBZ.sayThen = function (by, text, fn) { return CBZ.speech ? CBZ.speech.then(by, text, fn) : fn(text); };

  // a fade to black and back (sleep, a ride, a cut); cb runs while black
  CBZ.hmFade = function (cb, holdMs) {
    const D = ensureDom(); if (!D) { if (cb) cb(); return; }
    D.fade.style.opacity = "1";
    setTimeout(function () {
      try { if (cb) cb(); } catch (e) {}
      setTimeout(function () { D.fade.style.opacity = "0"; }, holdMs || 500);
    }, 620);
  };

  /* ================================================================
     BINOCULARS
     ================================================================ */
  const bino = {
    on: false, wasFP: null, fov: 9, owned: true,
    toggle: function (on) {
      on = !!on;
      if (on === bino.on) return;
      const pl = P();
      if (on && (!playing() || !pl || pl.dead || pl.driving || CBZ.cityMenuOpen || I.active || !bino.owned)) return;
      bino.on = on;
      const D = ensureDom();
      if (on) {
        if (CBZ.hmHold.isOpen()) holdClose();
        bino.wasFP = !!(CBZ.fps && CBZ.fps.active);
        if (!bino.wasFP && CBZ.setFPS) { try { CBZ.setFPS(true); } catch (e) {} }
        bino.prevHolster = !!g.cityHolstered; g.cityHolstered = true;
        if (D) D.bino.classList.add("hm-on");
      } else {
        if (bino.wasFP === false && CBZ.setFPS) { try { CBZ.setFPS(false); } catch (e) {} }
        bino.wasFP = null;
        if (bino.prevHolster != null) g.cityHolstered = bino.prevHolster;
        bino.prevHolster = null;
        if (D) D.bino.classList.remove("hm-on");
      }
    },
  };
  function wrapScopeFov() {
    const orig = CBZ.cityScopeFov;
    if (orig && orig._hmBino) return;
    const w = function () { if (bino.on) return bino.fov; return orig ? orig.apply(this, arguments) : null; };
    w._hmBino = true;
    CBZ.cityScopeFov = w;
  }
  const _rc = new THREE.Raycaster();
  let rangeT = 0;
  function tickBino(dt) {
    if (!bino.on) return;
    const pl = P();
    if (!playing() || !pl || pl.dead || pl.driving) { bino.toggle(false); return; }
    rangeT -= dt;
    if (rangeT <= 0 && dom && CBZ.camera) {
      rangeT = 0.3;
      // the rangefinder: first thing along the line of sight
      let r = null;
      try {
        _rc.setFromCamera({ x: 0, y: 0 }, CBZ.camera);
        _rc.far = 900;
        const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
        const hits = root ? _rc.intersectObject(root, true) : [];
        for (let i = 0; i < hits.length; i++) { if (hits[i].distance > 2) { r = hits[i].distance; break; } }
      } catch (e) { r = null; }
      dom.range.textContent = r ? (Math.round(r) + " M") : "- - -";
    }
  }
  CBZ.hmBinoculars = {
    active: function () { return bino.on; },
    toggle: function (on) { bino.toggle(on == null ? !bino.on : on); },
    range: function () { return 320; },
    setOwned: function (v) { bino.owned = v !== false; if (!bino.owned) bino.toggle(false); },
  };

  /* ================================================================
     INPUT — capture phase, so no other system reacts to our keys
     ================================================================ */
  function swallow(e) { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }
  window.addEventListener("keydown", function (e) {
    if (!playing()) return;
    const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const k = (e.key || "").toLowerCase();
    if (e.key === "Alt" || e.code === "AltLeft" || e.code === "AltRight") {
      if (!e.repeat && !I.active) bino.toggle(true);
      e.preventDefault();
      return;
    }
    if (I.active) {
      if (e.repeat) { swallow(e); return; }
      if (k === "a" || e.key === "ArrowLeft") { inspectStop(I.i - 1); swallow(e); return; }
      if (k === "d" || e.key === "ArrowRight") { inspectStop(I.i + 1); swallow(e); return; }
      if (k === "s" || e.key === "ArrowDown" || e.key === "Escape" || k === "w") { inspectExit(); swallow(e); return; }
      if (k === "e") { inspectUse(); swallow(e); return; }
      return;
    }
    if (CBZ.hmHold.isOpen()) {
      if (k === "e" || k === "j" || e.key === "Escape") {
        if (now() - H.openedAt > 0.2) holdClose();
        swallow(e); return;
      }
    }
    if (k === "e" && !e.repeat && V.cur && !CBZ.cityMenuOpen) { useVerb(); swallow(e); }
  }, true);
  window.addEventListener("keyup", function (e) {
    if (e.key === "Alt" || e.code === "AltLeft" || e.code === "AltRight") { bino.toggle(false); e.preventDefault(); }
  }, true);
  window.addEventListener("blur", function () { bino.toggle(false); });
  window.addEventListener("wheel", function (e) {
    if (!I.active || !I.o || !I.o.stops || I.o.stops.length < 2) return;
    inspectStop(I.i + (e.deltaY > 0 ? 1 : -1));
  }, { passive: true });
  // touch: a swipe moves between stops, a tap steps back; a tap on a held
  // paper puts it away. Only on the game canvas, never on HUD buttons.
  function onCanvas(e) { const R = CBZ.renderer; return !!(R && e.target === R.domElement); }
  window.addEventListener("touchstart", function (e) {
    if (!(I.active || CBZ.hmHold.isOpen()) || !onCanvas(e)) return;
    const t0 = e.changedTouches && e.changedTouches[0]; if (!t0) return;
    I.swipe = { x: t0.clientX, y: t0.clientY, t: now() };
  }, { capture: true, passive: true });
  window.addEventListener("touchend", function (e) {
    const s = I.swipe; I.swipe = null;
    if (!s || !onCanvas(e)) return;
    const t1 = e.changedTouches && e.changedTouches[0]; if (!t1) return;
    const dx = t1.clientX - s.x, dy = t1.clientY - s.y, dt = now() - s.t;
    if (I.active) {
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) inspectStop(I.i + (dx < 0 ? 1 : -1));
      else if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 0.35) inspectExit();
      else if (dy > 70) inspectExit();
      return;
    }
    if (CBZ.hmHold.isOpen() && Math.abs(dx) < 14 && Math.abs(dy) < 14 && dt < 0.35 && now() - H.openedAt > 0.3) holdClose();
  }, { capture: true, passive: true });

  /* ================================================================
     TICK
     ================================================================ */
  let lastT = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(39.2, function (dt) {
    dt = dt || 0;
    wrapScopeFov();
    tickHold(dt);
    tickInspect(dt);
    tickBino(dt);
    V.evalT -= dt;
    if (V.evalT <= 0) {
      V.evalT = 0.1;
      if (!I.active) evalVerbs();
      if (dom) dom.binoBtn.classList.toggle("hm-on", touch() && playing() && bino.owned && !(P() && P().driving) && !I.active);
      else if (touch()) ensureDom();
    }
    void lastT;
  });
})();
