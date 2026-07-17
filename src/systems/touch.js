/* ============================================================
   systems/touch.js — phone controls. A dynamic left-thumb joystick
   (move), right-side drag (look), and on-screen buttons (Jump, Sneak,
   Fire, Tips). A quick world tap raycasts the actual rendered mesh and
   attempts the nearby vehicle/large-animal action. Enables itself on the first
   touch (or any coarse-pointer device) and skips pointer-lock.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const SENS = 0.006, MAXR = 55, DEAD = 0.28;

  let built = false, enabled = false, crouch = false;
  const stick = { id: null, cx: 0, cy: 0, sx: 0, sy: 0, t0: 0, moved: 0 };
  const look = { id: null, lx: 0, ly: 0, sx: 0, sy: 0, t0: 0, moved: 0 };
  let baseEl, knobEl;
  const tapRay = window.THREE ? new THREE.Raycaster() : null;
  const tapNdc = window.THREE ? new THREE.Vector2() : null;
  const tapBox = window.THREE ? new THREE.Box3() : null;

  function enable() {
    if (enabled) return;
    enabled = true; CBZ.touchMode = true;
    document.body.classList.add("touch");
    build();
  }

  function build() {
    if (built) return; built = true;
    const wrap = document.createElement("div");
    wrap.id = "touch";
    wrap.innerHTML =
      '<div id="tstick"><div id="tknob"></div></div>' +
      '<div id="tbtns">' +
      '<button class="tbtn" id="ttips">TIPS</button>' +
      '<button class="tbtn" id="tview">VIEW</button>' +
      '<button class="tbtn" id="tswap">SWAP</button>' +
      '<button class="tbtn" id="treload">RELOAD</button>' +
      '<button class="tbtn" id="tcrouch">SNEAK</button>' +
      '<button class="tbtn" id="tfire">FIRE</button>' +
      '<button class="tbtn tbig" id="tjump">JUMP</button>' +
      "</div>";
    document.body.appendChild(wrap);
    baseEl = document.getElementById("tstick");
    knobEl = document.getElementById("tknob");

    holdBtn("tjump", (down) => { CBZ.keys[" "] = down; });
    // FIRE: in first-person it shoots/punches via the FPS module; otherwise
    // it's the third-person panic-fire (synthetic F).
    holdBtn("tfire", (down) => {
      if (((CBZ.fps && CBZ.fps.active) || (CBZ.weaponThirdPersonActive && CBZ.weaponThirdPersonActive())) && CBZ.fpsFire) CBZ.fpsFire(down);
      else if (down) {
        // unarmed: FIRE = throw a punch (matches desktop left-click melee)
        if (CBZ.game.mode === "survival") { if (CBZ.grapple) CBZ.grapple.punch(); }
        else if (CBZ.punch) CBZ.punch();
      }
    });
    tapBtn(document.getElementById("ttips"), () => { if (CBZ.toggleHelp) CBZ.toggleHelp(); });
    tapBtn(document.getElementById("tview"), () => { if (CBZ.toggleFPS) CBZ.toggleFPS(); });
    tapBtn(document.getElementById("tswap"), () => { if (CBZ.fpsNextWeapon) CBZ.fpsNextWeapon(); });
    tapBtn(document.getElementById("treload"), () => { if (CBZ.fpsReload) CBZ.fpsReload(); });
    const cb = document.getElementById("tcrouch");
    tapBtn(cb, () => { crouch = !crouch; CBZ.keys["shift"] = crouch; cb.classList.toggle("on", crouch); });
  }

  // press-and-hold button (jump/fire)
  function holdBtn(id, fn) {
    const b = document.getElementById(id);
    const on = (e) => { e.preventDefault(); b.classList.add("on"); fn(true); };
    const off = (e) => { e.preventDefault(); b.classList.remove("on"); fn(false); };
    b.addEventListener("touchstart", on, { passive: false });
    b.addEventListener("touchend", off, { passive: false });
    b.addEventListener("touchcancel", off, { passive: false });
    b.addEventListener("mousedown", on); b.addEventListener("mouseup", off);
  }
  // tap button (toggle/one-shot)
  function tapBtn(b, fn) {
    b.addEventListener("touchstart", (e) => { e.preventDefault(); fn(); }, { passive: false });
    b.addEventListener("mousedown", (e) => { e.preventDefault(); fn(); });
  }

  const inBtns = (t) => t && t.closest && t.closest("#tbtns");
  const inUI = (t) => t && t.closest && (t.closest("#interact") || t.closest(".screen") || t.closest("#tbtns"));

  function setMove(nx, ny) {
    const k = CBZ.keys;
    k["w"] = ny < -DEAD; k["s"] = ny > DEAD; k["a"] = nx < -DEAD; k["d"] = nx > DEAD;
  }
  function clearMove() { const k = CBZ.keys; k["w"] = k["a"] = k["s"] = k["d"] = false; }

  function note(s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(s, 1.5); }

  function rootFor(object, roots) {
    let o = object;
    while (o) {
      const hit = roots.get(o);
      if (hit) return hit;
      o = o.parent;
    }
    return null;
  }

  // Exact rendered-mesh picking: no aircraft-sized invisible interaction box.
  // Proximity is measured to the visible object's Box3, so a plane's door/wing
  // root is usable even when its origin is dozens of metres away.
  function tapWorld(x, y) {
    if (!tapRay || !CBZ.camera || !CBZ.player || !CBZ.player.pos || CBZ.game.state !== "playing") return false;
    if (CBZ.player.driving || CBZ.player._aircraft || (CBZ.cityArmorActive && CBZ.cityArmorActive())) return false;
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    tapNdc.set(((x - rect.left) / Math.max(1, rect.width)) * 2 - 1, -((y - rect.top) / Math.max(1, rect.height)) * 2 + 1);
    tapRay.setFromCamera(tapNdc, CBZ.camera);

    const roots = new Map(), objects = [];
    function add(group, kind, rec) {
      if (!group || group.visible === false || roots.has(group)) return;
      roots.set(group, { kind: kind, rec: rec, group: group });
      objects.push(group);
    }
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]; if (c && !c.dead && !c.player) add(c.group, "car", c);
    }
    const machines = CBZ.cityMilitaryVehicles || [];
    for (let i = 0; i < machines.length; i++) {
      const m = machines[i]; if (m && !m.taken) add(m.group, "machine", m);
    }
    const wildlife = CBZ.cityWildlife || [];
    for (let i = 0; i < wildlife.length; i++) {
      const a = wildlife[i];
      if (a && CBZ.cityCanRideAnimal && CBZ.cityCanRideAnimal(a)) add(a.group, "animal", a);
    }
    if (!objects.length) return false;
    const hits = tapRay.intersectObjects(objects, true);
    if (!hits.length) return false;
    const target = rootFor(hits[0].object, roots);
    if (!target) return false;
    tapBox.setFromObject(target.group);
    const edgeDistance = tapBox.distanceToPoint(CBZ.player.pos);

    if (target.kind === "car") {
      if (edgeDistance > 5.2) { note("Get closer to take that vehicle."); return true; }
      return !!(CBZ.cityEnterVehicle && CBZ.cityEnterVehicle(target.rec));
    }
    if (target.kind === "machine") {
      if (edgeDistance > 6.2) { note("Get closer to board it."); return true; }
      return !!(CBZ.cityBoardMilitaryVehicle && CBZ.cityBoardMilitaryVehicle(target.rec));
    }
    if (target.kind === "animal") {
      if (edgeDistance > 4.5) { note("Get closer before you try to mount it."); return true; }
      return !!(CBZ.cityMountAnimal && CBZ.cityMountAnimal(target.rec));
    }
    return false;
  }

  window.addEventListener("touchstart", (e) => {
    enable();
    for (const t of e.changedTouches) {
      if (inUI(t.target)) continue;
      if (t.clientX < innerWidth * 0.5 && stick.id === null) {
        stick.id = t.identifier; stick.cx = t.clientX; stick.cy = t.clientY;
        stick.sx = t.clientX; stick.sy = t.clientY; stick.t0 = performance.now(); stick.moved = 0;
        baseEl.style.left = t.clientX + "px"; baseEl.style.top = t.clientY + "px";
        baseEl.classList.add("on"); knobEl.style.transform = "";
      } else if (look.id === null) {
        look.id = t.identifier; look.lx = t.clientX; look.ly = t.clientY;
        look.sx = t.clientX; look.sy = t.clientY; look.t0 = performance.now(); look.moved = 0;
      }
    }
  }, { passive: true });

  let pinchPrev = 0;
  window.addEventListener("touchmove", (e) => {
    // two fingers = pinch-zoom the third-person camera
    if (e.touches.length >= 2 && !(CBZ.fps && CBZ.fps.active)) {
      const a = e.touches[0], b = e.touches[1];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchPrev && CBZ.camZoom) CBZ.camZoom((pinchPrev - d) * 0.03);
      pinchPrev = d; clearMove();
      return;
    }
    pinchPrev = 0;
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) {
        const dx = t.clientX - stick.cx, dy = t.clientY - stick.cy;
        stick.moved = Math.max(stick.moved, Math.hypot(t.clientX - stick.sx, t.clientY - stick.sy));
        const len = Math.hypot(dx, dy) || 1, cl = Math.min(len, MAXR);
        knobEl.style.transform = "translate(" + (dx / len * cl) + "px," + (dy / len * cl) + "px)";
        setMove(dx / MAXR, dy / MAXR);
      } else if (t.identifier === look.id) {
        look.moved = Math.max(look.moved, Math.hypot(t.clientX - look.sx, t.clientY - look.sy));
        CBZ.cam.yaw -= (t.clientX - look.lx) * SENS;
        CBZ.cam.pitch -= (t.clientY - look.ly) * SENS;
        CBZ.cam.pitch = Math.max(-0.18, Math.min(0.60, CBZ.cam.pitch));
        // in first-person, vertical drag drives the (wider) FPS aim pitch
        if (CBZ.fps && CBZ.fps.active) CBZ.fps.fp = Math.max(-1.3, Math.min(1.3, CBZ.fps.fp - (t.clientY - look.ly) * SENS));
        look.lx = t.clientX; look.ly = t.clientY;
      }
    }
  }, { passive: true });

  function endTouch(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) {
        const wasTap = stick.moved < 12 && performance.now() - stick.t0 < 330;
        stick.id = null; clearMove();
        knobEl.style.transform = ""; baseEl.classList.remove("on");
        if (wasTap) tapWorld(t.clientX, t.clientY);
      } else if (t.identifier === look.id) {
        const wasTap = look.moved < 12 && performance.now() - look.t0 < 330;
        look.id = null;
        if (wasTap) tapWorld(t.clientX, t.clientY);
      }
    }
  }
  window.addEventListener("touchend", endTouch, { passive: true });
  window.addEventListener("touchcancel", endTouch, { passive: true });

  // coarse-pointer device (phone/tablet): turn it on right away
  if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) enable();

  // controls only show while actually playing
  CBZ.onAlways(98, function () {
    if (!built) return;
    const el = document.getElementById("touch");
    const show = enabled && CBZ.game.state === "playing";
    el.style.display = show ? "block" : "none";
    if (!show && stick.id !== null) { stick.id = null; clearMove(); }
  });
})();
