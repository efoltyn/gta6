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
function stepWho() {
  const m = (cam.mode === "follow" || cam.mode === "you" || cam.shot === "point" ||
    cam.shot === "push" || cam.shot === "study" || cam.shot === "kill")
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
  cam.mode = mode;
  if (team) cam.followTeam = team;
  // the camera button lights while a director owns the lens, in the
  // followed army's colour when it is riding one of them
  const cb = el("cCam");
  cb.classList.toggle("on", mode !== "free");
  cb.style.setProperty("--cc", mode === "follow"
    ? "#" + TEAMS[cam.followTeam].color.toString(16).padStart(6, "0") : "#ff7a45");
  if (mode === "follow") {
    updatePoint();
    cam.followM = subjectFor(cam.followTeam) || hottestMan();
    cam.holdT = 0; cam.reptT = simT + 3;
    cam.shot = "point";          // else a stale AUTO framing rides along
  } else if (mode === "study" || mode === "under" || mode === "surface") {
    if (!STUDY.m || STUDY.m.dead) studyPick(null);
    cam.shot = "study";
  }
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
  const ring = ["auto", "followRed", "followBlue", "study"]
    .concat(wet ? ["under", "surface"] : []).concat(["free"]);
  const now = cam.mode === "follow" ? "follow" + (cam.followTeam === "red" ? "Red" : "Blue") : cam.mode;
  let i = ring.indexOf(now);
  const next = ring[(i + 1) % ring.length];
  if (next === "followRed") setCamMode("follow", "red");
  else if (next === "followBlue") setCamMode("follow", "blue");
  else setCamMode(next);
}
// manual orbit: pointers on the page, ignored while the UI owns them
let drag = null;
const pinch = { d: 0 };
function uiTarget(e) {
  return e.target && (e.target.closest && e.target.closest("#menu,#ctl,#end,button,select,input"));
}
CBZ.npcwar.onBoot(function () {
  window.addEventListener("pointerdown", function (e) {
    if (!started || uiTarget(e)) return;
    // a soldier's mouse is his rifle: a click with no lock takes the lock
    if (cam.mode === "you") { if (!COARSE && !CBZ.micro.input.locked) CBZ.micro.lock(); return; }
    if (cam.mode !== "free") setCamMode("free");
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, b: e.button };
  });
  window.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.b === 2) {
      const s = cam.dist * 0.0016;
      cam.wFocus.x += (-Math.cos(cam.yaw) * -dx + Math.sin(cam.yaw) * -dy) * s;
      cam.wFocus.z += (Math.sin(cam.yaw) * -dx + Math.cos(cam.yaw) * -dy) * s;
    } else {
      cam.wYaw -= dx * 0.0052;
      cam.wPitch = Math.max(pitchLo(), Math.min(1.42, cam.wPitch + dy * 0.004));
    }
  });
  window.addEventListener("pointerup", function () { drag = null; pinch.d = 0; });
  window.addEventListener("wheel", function (e) {
    if (!started || uiTarget(e) || cam.mode === "you") return;
    if (cam.mode !== "free") setCamMode("free");
    cam.wDist = Math.max(6, Math.min(420, cam.wDist * (e.deltaY > 0 ? 1.13 : 0.885)));
  }, { passive: true });
  window.addEventListener("touchmove", function (e) {
    if (!started || e.touches.length !== 2 || cam.mode === "you") return;
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY);
    if (pinch.d) cam.wDist = Math.max(6, Math.min(420, cam.wDist * (pinch.d / d)));
    pinch.d = d;
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
