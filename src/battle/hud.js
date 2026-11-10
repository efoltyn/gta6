"use strict";
/* src/battle/hud.js — NPC War: THE CARD + RESOLUTION.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ THE CARD
   The man on the lens, as two bars and nothing else: blood (only once he
   has been hit) and the magazine (only if he carries one), in his army's
   colour. A rifle emptying and refilling orange behind a wall is the rhythm
   of the fight; his name, his gun's label and his tally were words about it.

   Every write is guarded by a cached value: this runs at 10 Hz on a page
   that is already drawing a thousand bodies. */
const whoC = { on: null, team: "", hp: -1, low: null, mag: -1, rl: null, hasMag: null, hurt: null };
let lockBarOn = false;
function stepWho() {
  if (lockBarOn !== (cam.mode === "lock" || cam.mode === "fp")) setLockBar();
  const m = (cam.mode === "follow" || cam.mode === "you" || cam.shot === "hero" ||
    cam.shot === "charge" || cam.shot === "tripod" || cam.shot === "study" || cam.mode === "kill" || cam.mode === "lock" || cam.mode === "fp")
    ? cam.followM : null;
  const on = !!m && !m.dead;
  if (on !== whoC.on) { whoC.on = on; el("who").classList.toggle("on", on); }
  if (!on) return;
  if (m.team !== whoC.team) {
    whoC.team = m.team;
    el("who").style.setProperty("--tc", "#" + TEAMS[m.team].color.toString(16).padStart(6, "0"));
  }
  const hp = m.maxHp > 1e8 ? 1 : Math.max(0, Math.min(1, m.hp / m.maxHp));
  const hurt = hp < 0.995;
  if (hurt !== whoC.hurt) { whoC.hurt = hurt; el("whoHp").style.display = hurt ? "block" : "none"; }
  if (Math.abs(hp - whoC.hp) > 0.01) {
    whoC.hp = hp;
    el("whoHp").firstElementChild.style.width = (hp * 100) + "%";
    const low = hp < 0.34;
    if (low !== whoC.low) { whoC.low = low; el("whoHp").classList.toggle("low", low); }
  }
  const hasMag = m.magSize > 0;
  if (hasMag !== whoC.hasMag) { whoC.hasMag = hasMag; el("whoMagT").style.display = hasMag ? "block" : "none"; }
  if (!hasMag) return;
  const reloading = m.reloadT > 0;
  const w = CBZ.weaponById(m.wid) || {};
  const full = (w.reloadTime || w.reload) || 1.6;
  const frac = reloading ? Math.max(0, Math.min(1, 1 - m.reloadT / full)) : m.mag / m.magSize;
  if (Math.abs(frac - whoC.mag) > 0.01 || reloading !== whoC.rl) {
    whoC.mag = frac; whoC.rl = reloading;
    const t = el("whoMagT");
    t.classList.toggle("rl", reloading);
    t.firstElementChild.style.width = (frac * 100) + "%";
  }
}

function setCamMode(mode, team) {
  // a kill-cam beat in flight must not be left holding the old speed
  if (cam.mode === "kill" && mode !== "kill" && KILL.t > 0) {
    KILL.t = 0; KILL.m = null; setSpeed(KILL.speed);
  }
  if (SLOW.t > 0 && mode !== cam.mode) { SLOW.t = 0; if (speed > 0) setSpeed(SLOW.back); }
  // any lens but YOU's: the body you were driving goes back to its brain
  if (mode !== "you" && YOU.m) leaveYou(false);
  const was = cam.mode;
  if ((mode === "lock" || mode === "fp") && (was === "lock" || was === "fp") && cam.lockM && !cam.lockM.dead) {
    // lock <-> first person is the same unit through another window
    cam.mode = mode; cam.snap = true; cam.fpYaw = cam.fpPitch = 0; cam.fpIdle = 9; cam.fpZoom = 1;
    setLockBar();
    return;
  }
  cam.mode = mode;
  if (team) cam.followTeam = team;
  // the director takes a fresh shot the moment it is handed the lens
  if (mode === "auto" && was !== "auto") { cam.cutAt = simT; cam.sinceWide = 1; }
  if (mode !== "you") cam.wFov = cam.fov0;
  // the camera button lights while a director owns the lens, in the
  // followed army's colour when it is riding one of them
  paintCam();
  if (mode === "lock" || mode === "fp") {
    const m = lockPick(0);
    if (!m) { cam.mode = was; return; }       // nothing worth riding: stay where you were
    lockTo(m);
    cam.lockZoom = 1; cam.fpZoom = 1; cam.fpYaw = cam.fpPitch = 0; cam.fpIdle = 9;
    cam.shot = "lock";
  } else if (mode === "follow") {
    updatePoint();
    cam.followM = subjectFor(cam.followTeam) || hottestMan();
    cam.holdT = 0; cam.reptT = simT + 3;
    cam.shot = "point";          // else a stale AUTO framing rides along
  } else if (mode === "study" || mode === "under" || mode === "surface") {
    if (!STUDY.m || STUDY.m.dead) studyPick(null);
    cam.shot = "study";
  }
  FLING.px = FLING.py = FLING.ox = FLING.oy = 0;
  setLockBar();
}
/* LOCK / FP: two arrows to walk the roster and a window toggle, only while
   one of those lenses is on (a phone has no T key). */
function setLockBar() {
  let bar = document.getElementById("lockBar");
  const on = cam.mode === "lock" || cam.mode === "fp";
  if (!bar) {
    if (!on) return;
    bar = document.createElement("div");
    bar.id = "lockBar";
    bar.innerHTML = '<button data-k="prev" aria-label="previous unit">&#8249;</button>' +
      '<button data-k="fp" aria-label="first person">1ST</button>' +
      '<button data-k="next" aria-label="next unit">&#8250;</button>';
    bar.addEventListener("click", function (e) {
      const b = e.target.closest && e.target.closest("button");
      if (!b) return;
      if (b.dataset.k === "fp") setCamMode(cam.mode === "fp" ? "lock" : "fp");
      else lockStep(b.dataset.k === "next" ? 1 : -1);
      setLockBar();
    });
    document.body.appendChild(bar);
  }
  lockBarOn = on;
  bar.classList.toggle("on", on);
  const f = bar.querySelector('[data-k="fp"]');
  if (f) f.classList.toggle("lit", cam.mode === "fp");
}
/* AUTO -> FOLLOW RED -> FOLLOW BLUE -> STUDY -> (the water postures) -> FREE.
   Both armies have a front and which one you ride is the question a
   spectator has; which ANIMAL you are looking at is the question this map
   was built to answer, so STUDY is in the ring for every venue. UNDER and
   WAVE are only in it where there is a waterline to be on the wrong side
   of — offering "look up through the sea" on the kill box is a control that
   does nothing, which is worse than no control. */
function cycleCam() {
  const wet = !!(MAP && MAP.water && !SWIM_OLD);
  const ring = ["auto", "followRed", "followBlue", "lock", "study"]
    .concat(wet ? ["under", "surface"] : []).concat(["free"]);
  const now = cam.mode === "follow" ? "follow" + (cam.followTeam === "red" ? "Red" : "Blue") : cam.mode === "fp" ? "lock" : cam.mode;
  let i = ring.indexOf(now);
  const next = ring[(i + 1) % ring.length];
  if (next === "followRed") setCamMode("follow", "red");
  else if (next === "followBlue") setCamMode("follow", "blue");
  else setCamMode(next);
}
/* ============================================================ THE HANDS
   Spectating, the pointers are the FREE camera and the finger that takes a
   unit over:
     tap / click a unit          you are it (player.js takeOver)
     drag (one finger, left)     orbit
     right-drag, shift-drag, two fingers   pan (grab the ground)
     wheel, pinch                zoom
   A tap that is not a drag never kicks the director off the lens; the first
   real drag (8 px) hands the camera to your hands. Possessed, a click takes
   the pointer lock (the mouse is the look, the button is attack) and the
   phone's thumbs belong to microboot's stick and look layer. */
const PTR = new Map();
let gest = null;
function uiTarget(e) {
  return e.target && (e.target.closest && e.target.closest("#menu,#ctl,#end,button,select,input,.mt-btn,.mt-stick"));
}
function camPan(dx, dy) {
  /* GRAB THE GROUND: a pixel of finger is a pixel of ground under it. The
     width of the view at the focus, over the height of the screen, so the map
     sticks to the thumb at any zoom and any glass. Looking along the ground
     a vertical drag covers more of it, which the tilt term accounts for. */
  const c = CBZ.camera;
  const s = 2 * cam.dist * Math.tan((c.fov || 60) * Math.PI / 360) / Math.max(320, window.innerHeight);
  const tilt = 1 / Math.max(0.45, Math.sin(Math.max(0.1, cam.wPitch)));
  // screen right on the ground is (cos yaw, -sin yaw); screen up is (-sin, -cos).
  // The TARGET yaw: a turn still in flight must not skew the drag.
  const y = cam.wYaw;
  const rx = Math.cos(y), rz = -Math.sin(y), fx = -Math.sin(y), fz = -Math.cos(y);
  cam.wFocus.x += (-rx * dx + fx * dy * tilt) * s;
  cam.wFocus.z += (-rz * dx + fz * dy * tilt) * s;
  cam.wFocus.y = MAP.groundAt(cam.wFocus.x, cam.wFocus.z);
}
function camOrbit(dx, dy) {
  cam.wYaw -= dx * 0.0052;
  cam.wPitch = Math.max(pitchLo(), Math.min(1.42, cam.wPitch + dy * 0.004));
}
// the arm is multiplicative (a wheel notch is a fraction of the way in, not
// a fixed number of metres), from a shoulder to the whole field
function camZoom(k) {
  if (cam.mode === "lock" || cam.mode === "fp") { lockZoom(k); return; }
  cam.wDist = Math.max(1.4, Math.min(2200, cam.wDist * k));
}
// the finger's own speed, for the glide when it lifts
const FV = { x: 0, y: 0, t: 0, mode: null };
function flingNote(dx, dy, mode) {
  const now = performance.now(), dtm = Math.max(4, now - FV.t) / 1000;
  FV.t = now;
  const k = Math.min(1, dtm * 12);
  FV.x += (dx / dtm - FV.x) * k; FV.y += (dy / dtm - FV.y) * k;
  FV.mode = mode;
}
CBZ.npcwar.onBoot(function () {
  window.addEventListener("pointerdown", function (e) {
    if (!started || uiTarget(e)) return;
    // a soldier's mouse is his weapon: a click with no lock takes the lock
    if (cam.mode === "you") { if (!COARSE && !CBZ.micro.input.locked) CBZ.micro.lock(); return; }
    FV.x = FV.y = 0; FV.t = performance.now(); FV.mode = null;
    FLING.px = FLING.py = FLING.ox = FLING.oy = 0;       // a touch stops the glide
    PTR.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), b: e.button, shift: e.shiftKey });
    if (!gest) gest = { moved: false, cx: 0, cy: 0, sp: 0, two: false };
    gest.two = false;                       // a second finger re-seeds the pair
  });
  window.addEventListener("pointermove", function (e) {
    const p = PTR.get(e.pointerId);
    if (!p || !gest) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (!gest.moved && Math.hypot(p.x - p.sx, p.y - p.sy) > 8) {
      gest.moved = true;
      // a lock or first-person lens stays on its unit while the hand looks round it
      if (cam.mode !== "free" && cam.mode !== "lock" && cam.mode !== "fp") setCamMode("free");
    }
    if (!gest.moved) return;
    const riding = cam.mode === "lock" || cam.mode === "fp";
    if (PTR.size >= 2) {
      const it = PTR.values(), a = it.next().value, b = it.next().value;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, sp = Math.hypot(a.x - b.x, a.y - b.y);
      const an = Math.atan2(b.y - a.y, b.x - a.x);
      if (gest.two) {
        // pinch = dolly, centre = pan, twist = turn (all at once, like a map)
        if (!riding) camPan(cx - gest.cx, cy - gest.cy);
        if (gest.sp > 4 && sp > 4) camZoom(gest.sp / sp);
        let da = an - gest.an;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        if (Math.abs(da) < 0.6) { if (riding) lockLook(-da / 0.0052, 0); else cam.wYaw += da; }
        if (!riding) flingNote(cx - gest.cx, cy - gest.cy, "pan");
      }
      gest.two = true; gest.cx = cx; gest.cy = cy; gest.sp = sp; gest.an = an;
    } else if (riding) lockLook(dx, dy);
    else if (p.b === 2 || p.shift) { camPan(dx, dy); flingNote(dx, dy, "pan"); }
    else { camOrbit(dx, dy); flingNote(dx, dy, "orbit"); }
  });
  const up = function (e) {
    const p = PTR.get(e.pointerId);
    PTR.delete(e.pointerId);
    // lifted at speed: let it glide (a pause before the lift = no glide)
    if (p && gest && gest.moved && PTR.size === 0 && FV.mode && performance.now() - FV.t < 70 && cam.mode === "free") {
      const cap = 2600;
      const vx = Math.max(-cap, Math.min(cap, FV.x)), vy = Math.max(-cap, Math.min(cap, FV.y));
      if (FV.mode === "pan") { FLING.px = vx; FLING.py = vy; } else { FLING.ox = vx; FLING.oy = vy; }
    }
    if (p && gest && !gest.moved && PTR.size === 0 && p.b === 0 && performance.now() - p.t < 450 && started && !over) tapTake(p.x, p.y);
    if (PTR.size === 0) gest = null;
    else if (gest) gest.two = false;
  };
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  window.addEventListener("wheel", function (e) {
    if (!started || uiTarget(e) || cam.mode === "you") return;
    if (cam.mode !== "free" && cam.mode !== "lock" && cam.mode !== "fp") setCamMode("free");
    // a mouse notch is ~100 and a trackpad's flick is a stream of small
    // numbers: the zoom follows the distance scrolled, not the event count
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    camZoom(Math.exp(Math.max(-240, Math.min(240, dy)) * 0.0016));
  }, { passive: true });
  window.addEventListener("contextmenu", function (e) { if (started && !uiTarget(e)) e.preventDefault(); });
});

/* ============================================================ RESOLUTION
   The cheapest frames in a massive battle are the pixels you stop drawing.
   When the frame rate slips the render scale steps down before anything
   else does; it climbs back when the war thins out. */
/* SPEED NEVER COSTS HD (owner): the scale never drops under one pixel per CSS
   pixel. A tiered war (src/battle/mass.js) buys its frames with tiers and
   the far crowd (src/battle/settingspanel.js AUTO), not with a blurrier
   picture; the steps that are left are a high-DPI screen's extra density,
   under the quality preset's ceiling (RES.cap). */
const RES = { steps: [1], idx: 0, t: 0, good: 0, cap: 2 };
function initRes(total) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2, RES.cap || 2);
  RES.steps = [dpr, 1.5, 1].filter(function (v, i, a) { return v <= dpr + 1e-6 && a.indexOf(v) === i; })
    .sort(function (a, b) { return b - a; });
  RES.idx = total > 900 && RES.steps.length > 1 ? 1 : 0;
  applyRes();
}
function applyRes() {
  const R = CBZ.renderer;
  if (!R || !R.setPixelRatio) return;
  R.setPixelRatio(RES.steps[RES.idx]);
  R.setSize(window.innerWidth, window.innerHeight, false);
}
function stepRes(dt) {
  RES.t -= dt;
  if (RES.t > 0) return;
  RES.t = 1.6;
  const fps = CBZ.micro.fps || 0;
  if (fps > 4 && fps < 28 && RES.idx < RES.steps.length - 1) { RES.idx++; RES.good = 0; applyRes(); }
  else if (fps > 50 && RES.idx > 0 && ++RES.good >= 3) { RES.good = 0; RES.idx--; applyRes(); }
}
