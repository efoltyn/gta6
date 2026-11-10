"use strict";
/* src/battle/clock.js — NPC War: CLOCK.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ CLOCK */
const SPEED_RING = [1, 2, 4, 8, 0.25];
function setSpeed(s) {
  if (s > 0) lastSpeed = s;
  speed = s;
  const pb = el("cPause");
  pb.textContent = s === 0 ? "RESUME" : "PAUSE";
  pb.classList.toggle("on", s === 0);
  const sb = el("cSpeed"), shown = s === 0 ? lastSpeed : s;
  sb.innerHTML = "SPEED " + (shown < 1 ? "&frac14;" : shown) + "&times;";
  sb.classList.toggle("on", shown !== 1);
}
CBZ.npcwar.onBoot(function () {
  el("cPause").addEventListener("click", function () { setSpeed(speed === 0 ? lastSpeed : 0); });
  el("cSpeed").addEventListener("click", function () {
    const i = SPEED_RING.indexOf(speed === 0 ? lastSpeed : speed);
    setSpeed(SPEED_RING[(i + 1) % SPEED_RING.length]);
  });
  /* THE CAMERA IS FOUR NAMED BUTTONS, not one eye icon that stepped blind
     through six modes. The lit one is the one you are on (paintCam). */
  el("cCamSeg").addEventListener("click", function (e) {
    const b = e.target.closest && e.target.closest("button");
    if (!b) return;
    const k = b.dataset.cam;
    if (k === "follow") setCamMode("follow", cam.mode === "follow" && cam.followTeam === "red" ? "blue" : "red");
    else setCamMode(k);
  });
});
/* THE CONTROLS LEAVE THE PICTURE. Still mouse for three seconds and the row
   fades out; any movement, touch or key brings it back. On a touch screen it
   only dims, since there is no hover to summon it with. */
let ctlIdleAt = 0;
function wakeCtl() {
  ctlIdleAt = performance.now() + 3000;
  el("ctl").classList.remove("idle");
}
/* THE RIFLE BUTTON: only where there are men (or a crewed hull) to carry one */
// which camera button is lit, and what the takeover button says
function paintCam() {
  const seg = el("cCamSeg");
  if (!seg || !seg.querySelectorAll) return;
  const now = cam.mode === "fp" ? "lock" : cam.mode;
  seg.querySelectorAll("button").forEach(function (b) {
    const on = b.dataset.cam === now;
    b.classList.toggle("on", on);
    b.style.setProperty("--cc", on && now === "follow" ? "#" + TEAMS[cam.followTeam].color.toString(16).padStart(6, "0") : "#ff7a45");
    if (b.dataset.cam === "follow") b.textContent = on ? "FRONT LINE: " + TEAMS[cam.followTeam].name : "FRONT LINE";
  });
  const r = el("cRifle");
  if (r) { const mine = cam.mode === "you" || cam.mode === "youdead"; r.textContent = mine ? "LEAVE (G)" : "TAKE CONTROL"; r.classList.toggle("on", mine); }
}
function paintCtl() {
  const r = el("cRifle");
  if (r) r.classList.toggle("hide", !youTeam() || !!bench);
}
CBZ.npcwar.onBoot(function () {
  ["pointermove", "pointerdown", "keydown", "wheel"].forEach(function (ev) {
    window.addEventListener(ev, wakeCtl, { passive: true });
  });
  // out of the war: back to the war room (which carries MAIN MENU to the hub)
  el("cBack").addEventListener("click", function () {
    location.href = location.pathname;
  });
  el("cRifle").addEventListener("click", function () { toggleRifle(); });
});
