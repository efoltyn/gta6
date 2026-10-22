/* ============================================================
   systems/liftpanel.js — THE CAR'S FLOOR PANEL. One for every lift.

   Owner (2026-10-22): "elevator controls are terrible." The city cab offered
   four floors on E/2/3/4; the island car offered Up / Down and a Stop you had
   to hit at the right moment. Now both show this: a small steel panel on the
   car's panel side of the screen, there the moment you stand in the car, with
   every stop the lift serves as a button, your floor lit, the floor you chose
   lit amber, and a floor display that ticks during the ride.

   No lift logic lives here. The owner (city/elevators.js, the island towers
   in world/disaster_arena.js) re-arms the panel every frame while the player
   stands in a car and is handed back the floor that was chosen:

     CBZ.liftPanel.show(key, spec)   arm/refresh (retires ~0.16 s after the
                                      owner stops calling it)
       key      which car ("city:3", "isle:0"); a new key resets the panel
       spec.stops    [{ label, name, num, roof }] bottom (0) to top
                     label  what is printed on the button ("G", "12", "R")
                     name   the building's word for it ("Penthouse"), or ""
                     num    the number you type for it (G = 0), or null
       spec.at       the stop the car stands at (or left from, riding)
       spec.dest     the stop it is going to, or -1
       spec.riding   true while the car moves
       spec.display  the floor display's text while riding ("14")
       spec.up       riding up (the arrow)
       spec.reach(j) optional: can stop j still be chosen right now
       spec.pick(j)  the floor button. Returns true when the lift took it.
       spec.at3      optional {x,y,z} of the car's panel: picks the screen side
     CBZ.liftPanel.hide(key)   CBZ.liftPanel.isOpen()

   Inputs, all of them, while the panel is up:
     tap / click  a floor
     1..9, 0      type the floor ("1" "2" = 12, short window); 0 / G = ground,
                  R = roof
     Up / Down, mouse wheel   move the highlight; E / Enter send it
     controller   d-pad up/down moves the highlight, A sends it
   Q is never bound (the city's verb wheel). The keys are taken in the
   capture phase on window, registered before systems/interactions.js, so a
   key the panel uses fires nothing else.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = typeof window !== "undefined" ? window.CBZ : null;
  if (!CBZ || typeof document === "undefined") return;

  const TYPE_MS = 900;          // typing window between digits
  const LIVE_MS = 160;          // the owner stopped arming: the panel goes
  const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

  let root = null, disp = null, grid = null, btns = [];
  let cur = null;               // { key, spec, sig, hi, lastArm, side }
  let buf = "", bufT = 0, bufTimer = 0;
  let wheelAcc = 0;
  let keyed = false;            // a key/wheel/pad moved the highlight: show the ring

  function css() {
    if (document.getElementById("liftPanelCss")) return;
    const s = document.createElement("style");
    s.id = "liftPanelCss";
    s.textContent =
      "#liftPanel{position:fixed;top:50%;transform:translateY(-50%);z-index:30;display:none;" +
      "padding:9px 9px 10px;border-radius:9px;user-select:none;-webkit-user-select:none;touch-action:manipulation;" +
      "background:linear-gradient(160deg,#8d959e 0%,#5f666f 46%,#7b838c 100%);" +
      "box-shadow:0 6px 18px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.35),inset 0 -1px 0 rgba(0,0,0,.35);" +
      "font-family:'Helvetica Neue',Arial,system-ui,sans-serif}" +
      "#liftPanel.on{display:block}" +
      "#liftPanel.right{right:calc(16px + env(safe-area-inset-right,0px))}" +
      "#liftPanel.left{left:calc(16px + env(safe-area-inset-left,0px))}" +
      "#liftPanel .lpd{margin:0 auto 9px;min-width:54px;padding:4px 8px;border-radius:4px;background:#0b0c0d;" +
      "box-shadow:inset 0 1px 3px rgba(0,0,0,.9);color:#ff9a2e;text-align:center;font:700 17px/1.1 'Courier New',monospace;" +
      "letter-spacing:1px;text-shadow:0 0 6px rgba(255,140,30,.6);white-space:nowrap}" +
      "#liftPanel .lpd i{font-style:normal;font-size:12px;margin-right:5px;opacity:.9}" +
      "#liftPanel .lpg{display:grid;gap:7px 9px;justify-content:center;align-items:center}" +
      "#liftPanel .lpc{display:flex;align-items:center;justify-content:flex-end;gap:6px}" +
      "#liftPanel .lpn{font:600 10px/1 'Helvetica Neue',Arial,sans-serif;color:#1d2126;text-transform:uppercase;" +
      "letter-spacing:.6px;text-shadow:0 1px 0 rgba(255,255,255,.3);white-space:nowrap}" +
      "#liftPanel button{all:unset;box-sizing:border-box;cursor:pointer;width:var(--b,38px);height:var(--b,38px);border-radius:50%;" +
      "display:flex;align-items:center;justify-content:center;flex:none;" +
      "background:radial-gradient(circle at 50% 40%,#d9dde1 0%,#a7adb3 55%,#80868d 100%);" +
      "box-shadow:0 0 0 2px #4a5058,0 0 0 3px rgba(255,255,255,.25),0 2px 3px rgba(0,0,0,.45);" +
      "color:#2b3036;font:700 calc(var(--b,38px)*.38)/1 'Helvetica Neue',Arial,sans-serif;transition:box-shadow .12s,color .12s}" +
      "#liftPanel button.here{color:#f4fbff;text-shadow:0 0 5px #9fd4ff,0 0 1px #fff;" +
      "background:radial-gradient(circle at 50% 40%,#c6ccd2 0%,#8d949b 60%,#6f767d 100%)}" +
      "#liftPanel button.dest{color:#fff6e0;text-shadow:0 0 6px #ffb347;" +
      "box-shadow:0 0 0 2px #ffae3a,0 0 10px 2px rgba(255,170,60,.75),0 2px 3px rgba(0,0,0,.45)}" +
      "#liftPanel button.off{opacity:.45}" +
      "#liftPanel.keyed button.hi{outline:2px solid #fff;outline-offset:3px}" +
      "#liftPanel button:active{transform:scale(.94)}";
    (document.head || document.body).appendChild(s);
  }

  function ensure() {
    if (root) return root;
    if (!document.body) return null;
    css();
    root = document.createElement("div");
    root.id = "liftPanel";
    disp = document.createElement("div"); disp.className = "lpd";
    grid = document.createElement("div"); grid.className = "lpg";
    root.appendChild(disp); root.appendChild(grid);
    // a tap anywhere on the plate is the panel's, never a world tap / a look drag
    const eat = function (e) { e.stopPropagation(); };
    root.addEventListener("pointerdown", eat);
    root.addEventListener("touchstart", eat, { passive: true });
    root.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); });
    document.body.appendChild(root);
    return root;
  }

  function n() { return cur ? cur.spec.stops.length : 0; }
  function natural(spec) {
    const N = spec.stops.length;
    return spec.at === 0 ? N - 1 : 0;
  }

  // two columns past eight stops, the way a tall building's panel reads;
  // highest floors at the top, the ground at the bottom
  function build(spec) {
    const stops = spec.stops, N = stops.length;
    const cols = N > 8 ? 2 : 1, rows = Math.ceil(N / cols);
    const vh = (typeof innerHeight === "number" && innerHeight) || 720;
    const b = Math.round(Math.max(26, Math.min(40, (vh * 0.72 - 56) / rows - 7)));
    root.style.setProperty("--b", b + "px");
    grid.style.gridTemplateColumns = "repeat(" + cols + ",auto)";
    grid.textContent = "";
    btns = new Array(N);
    // row-major from the top: with two columns, the higher of each pair sits
    // on the right (a real panel's odd/even rows)
    const order = [];
    for (let r = rows - 1; r >= 0; r--) for (let c = 0; c < cols; c++) { const j = r * cols + c; order.push(j < N ? j : -1); }
    for (const j of order) {
      const cell = document.createElement("div");
      cell.className = "lpc";
      if (j >= 0) {
        const s = stops[j];
        if (s.name) { const nm = document.createElement("span"); nm.className = "lpn"; nm.textContent = s.name; cell.appendChild(nm); }
        const bt = document.createElement("button");
        bt.type = "button";
        bt.textContent = s.label;
        bt.addEventListener("pointerdown", function (e) {
          e.preventDefault(); e.stopPropagation();
          keyed = false;
          send(j);
        });
        cell.appendChild(bt);
        btns[j] = bt;
      }
      grid.appendChild(cell);
    }
  }

  function pickSide(spec) {
    if (spec.side === "left" || spec.side === "right") return spec.side;
    const a = spec.at3, cam = CBZ.camera, T = typeof THREE !== "undefined" ? THREE : (typeof window !== "undefined" ? window.THREE : null);
    if (a && cam && T && T.Vector3) {
      try {
        const v = new T.Vector3(a.x, a.y, a.z).project(cam);
        if (v.z < 1 && isFinite(v.x)) return v.x < -0.05 ? "left" : "right";
      } catch (e) { /* no camera yet */ }
    }
    return "right";
  }

  function paint() {
    if (!cur || !root) return;
    const spec = cur.spec, N = n();
    for (let j = 0; j < N; j++) {
      const bt = btns[j]; if (!bt) continue;
      const here = !spec.riding && j === spec.at;
      const dest = j === spec.dest;
      const off = spec.riding && typeof spec.reach === "function" && !dest && !spec.reach(j);
      const cls = (here ? "here " : "") + (dest ? "dest " : "") + (off ? "off " : "") + (j === cur.hi ? "hi" : "");
      if (bt._c !== cls) { bt._c = cls; bt.className = cls; }
    }
    const atS = spec.stops[spec.at] || {};
    const txt = spec.riding ? ((spec.up ? "▲" : "▼") + "|" + (spec.display != null ? spec.display : atS.label)) : ("|" + (atS.label || ""));
    if (disp._t !== txt) {
      disp._t = txt;
      const parts = txt.split("|");
      disp.textContent = "";
      if (parts[0]) { const i = document.createElement("i"); i.textContent = parts[0]; disp.appendChild(i); }
      disp.appendChild(document.createTextNode(parts[1]));
    }
    const k = keyed ? "keyed" : "";
    if (root._k !== k) { root._k = k; root.classList.toggle("keyed", keyed); }
  }

  function show(key, spec) {
    if (!spec || !spec.stops || !spec.stops.length || !ensure()) return false;
    const sig = spec.stops.map((s) => s.label + "/" + (s.name || "")).join(",");
    const fresh = !cur || cur.key !== key;
    if (fresh || cur.sig !== sig) {
      const hiWas = !fresh && cur ? cur.hi : -1;
      cur = { key: key, spec: spec, sig: sig, hi: hiWas >= 0 && hiWas < spec.stops.length ? hiWas : natural(spec), lastArm: 0, at: spec.at, side: pickSide(spec) };
      build(spec);
      root.classList.remove("left", "right");
      root.classList.add(cur.side);
      buf = "";
      padPrev = null;
      if (fresh) keyed = false;
    }
    // a new landing (arrived, or the car is idle at another stop): the
    // highlight goes back to the natural trip from here
    if (!spec.riding && spec.at !== cur.at) { cur.hi = natural(spec); }
    if (!spec.riding) cur.at = spec.at;
    cur.spec = spec;
    cur.lastArm = now();
    if (!root.classList.contains("on")) root.classList.add("on");
    paint();
    return true;
  }

  function close() {
    cur = null; buf = ""; padPrev = null;
    if (bufTimer) { clearTimeout(bufTimer); bufTimer = 0; }
    if (root) root.classList.remove("on");
  }
  function hide(key) { if (cur && (key == null || cur.key === key)) close(); }
  function isOpen() { return !!(cur && now() - cur.lastArm <= LIVE_MS); }

  function send(j) {
    if (!cur || j < 0 || j >= n()) return false;
    cur.hi = j;
    const spec = cur.spec;
    if (!spec.riding && j === spec.at) { paint(); return false; }
    let took = false;
    try { took = !!(spec.pick && spec.pick(j)); } catch (e) { took = false; }
    if (took) spec.dest = j;
    paint();
    return took;
  }

  function move(dir) {
    if (!cur) return;
    const N = n();
    cur.hi = Math.max(0, Math.min(N - 1, cur.hi + dir));
    keyed = true;
    paint();
  }

  function indexOfNum(v) {
    const S = cur.spec.stops;
    for (let j = 0; j < S.length; j++) if (S[j].num === v) return j;
    return -1;
  }
  function longerFrom(p) {
    const S = cur.spec.stops;
    for (let j = 0; j < S.length; j++) {
      const s = S[j].num;
      if (s == null) continue;
      const t = String(s);
      if (t.length > p.length && t.indexOf(p) === 0) return j;
    }
    return -1;
  }
  function typed(d) {
    if (!cur) return;
    const t = now();
    if (t - bufT > TYPE_MS) buf = "";
    bufT = t;
    if (bufTimer) { clearTimeout(bufTimer); bufTimer = 0; }
    if (buf === "" && d === "0") { send(0); return; }
    let p = buf + d;
    if (indexOfNum(+p) < 0 && longerFrom(p) < 0) p = d;      // no floor starts like that: start over
    const exact = indexOfNum(+p), longer = longerFrom(p);
    keyed = true;
    if (exact >= 0 && longer < 0) { buf = ""; send(exact); return; }
    if (exact < 0 && longer < 0) { buf = ""; paint(); return; }
    buf = p;
    cur.hi = exact >= 0 ? exact : longer;
    paint();
    bufTimer = setTimeout(function () {
      bufTimer = 0;
      if (!cur || !buf) return;
      const j = indexOfNum(+buf);
      buf = "";
      if (j >= 0) send(j);
    }, TYPE_MS);
  }
  function roofIndex() {
    const S = cur.spec.stops;
    for (let j = 0; j < S.length; j++) if (S[j].roof) return j;
    return S.length - 1;
  }

  // ---- keyboard: capture phase on window, before every other listener ----
  addEventListener("keydown", function (e) {
    if (!isOpen()) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const gm = CBZ.game;
    if (!gm || gm.state !== "playing") return;
    if (CBZ.verbWheel && CBZ.verbWheel.isOpen && CBZ.verbWheel.isOpen()) return;
    const k = String(e.key || "").toLowerCase();
    let used = true;
    if (k.length === 1 && k >= "0" && k <= "9") { if (!e.repeat) typed(k); }
    else if (k === "g") { if (!e.repeat) { keyed = true; send(0); } }
    else if (k === "r") { if (!e.repeat) { keyed = true; send(roofIndex()); } }
    else if (k === "arrowup") move(1);
    else if (k === "arrowdown") move(-1);
    else if (k === "e" || k === "enter") { if (!e.repeat) send(cur.hi); }
    else if (k === "m" && e.isTrusted === false) { /* the controller's d-pad up (gamepad.js taps M): it is the highlight here */ }
    else used = false;
    if (!used) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  // ---- mouse wheel: one notch, one floor ----
  addEventListener("wheel", function (e) {
    if (!isOpen()) return;
    const gm = CBZ.game;
    if (!gm || gm.state !== "playing") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    while (wheelAcc <= -40) { wheelAcc += 40; move(1); }
    while (wheelAcc >= 40) { wheelAcc -= 40; move(-1); }
  }, { capture: true, passive: false });

  // ---- controller: polled here, only while the panel is up ----
  // (systems/gamepad.js has no button read-out; the standard mapping's
  // d-pad up 12 / down 13 and A 0)
  let padPrev = null, padRep = 0;
  function btnDown(pad, i) { const b = pad.buttons && pad.buttons[i]; return !!(b && (typeof b === "object" ? b.pressed || b.value > 0.5 : b > 0.5)); }
  function pollPad(dt) {
    if (!isOpen() || typeof navigator === "undefined" || !navigator.getGamepads) return;
    if (!CBZ.game || CBZ.game.state !== "playing") return;
    let pads;
    try { pads = navigator.getGamepads(); } catch (e) { return; }
    let pad = null;
    for (let i = 0; pads && i < pads.length; i++) if (pads[i] && pads[i].connected) { pad = pads[i]; break; }
    if (!pad) return;
    const up = btnDown(pad, 12), dn = btnDown(pad, 13), a = btnDown(pad, 0);
    if (!padPrev) { padPrev = { up: up, dn: dn, a: a }; return; }    // a button already held as the panel opened is not a press
    if (up && !padPrev.up) { move(1); padRep = 0.4; }
    else if (dn && !padPrev.dn) { move(-1); padRep = 0.4; }
    else if (up || dn) {
      padRep -= dt || 0.016;
      if (padRep <= 0) { move(up ? 1 : -1); padRep = 0.12; }
    }
    if (a && !padPrev.a) { keyed = true; send(cur.hi); }
    padPrev.up = up; padPrev.dn = dn; padPrev.a = a;
  }

  if (CBZ.onAlways) {
    CBZ.onAlways(3, function (dt) {
      if (cur && now() - cur.lastArm > LIVE_MS) close();
      if (cur) pollPad(dt);
    });
  }

  CBZ.liftPanel = { show: show, hide: hide, isOpen: isOpen };
})();
