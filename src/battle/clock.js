"use strict";
/* src/battle/clock.js — NPC War: CLOCK.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ CLOCK */
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
const ICON_FAST = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6l8 6-8 6zM12 6l8 6-8 6z"/></svg>';
const SPEED_RING = [1, 2, 4, 8, 0.25];
function setSpeed(s) {
  if (s > 0) lastSpeed = s;
  speed = s;
  const pb = el("cPause");
  pb.innerHTML = s === 0 ? ICON_PLAY : ICON_PAUSE;
  pb.classList.toggle("on", s === 0);
  // the speed button is the fast-forward mark at real time and the dial's
  // number once it is anything else
  const sb = el("cSpeed"), shown = s === 0 ? lastSpeed : s;
  sb.innerHTML = shown === 1 ? ICON_FAST : (shown < 1 ? "&frac14;" : shown) + "&times;";
  sb.classList.toggle("on", shown !== 1);
}
CBZ.npcwar.onBoot(function () {
  el("cPause").addEventListener("click", function () { setSpeed(speed === 0 ? lastSpeed : 0); });
  el("cSpeed").addEventListener("click", function () {
    const i = SPEED_RING.indexOf(speed === 0 ? lastSpeed : speed);
    setSpeed(SPEED_RING[(i + 1) % SPEED_RING.length]);
  });
  el("cCam").addEventListener("click", function () {
    cycleCam();
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
CBZ.npcwar.onBoot(function () {
  ["pointermove", "pointerdown", "keydown", "wheel"].forEach(function (ev) {
    window.addEventListener(ev, wakeCtl, { passive: true });
  });
  // out of the war: back to the war room (which carries MAIN MENU to the hub)
  el("cBack").addEventListener("click", function () {
    if (FRONT) { frontPost(over ? "end" : "leave"); return; }
    location.href = location.pathname;
  });
  el("cRifle").addEventListener("click", function () { toggleRifle(); });
  el("cHold").addEventListener("click", function () {
    ORDER.red = ORDER.red === "hold" ? "advance" : "hold";
    // a man told to go is told now, not on his next think
    for (let i = 0; i < men.length; i++) if (men[i].team === "red") men[i].thinkAt = simT;
    paintFrontCtl();
  });
  el("cAir").addEventListener("click", function () { callAir(); });
});
