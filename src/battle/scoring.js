"use strict";
/* src/battle/scoring.js — NPC War: BANNER / END + THE CALL.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ BANNER / END
   The banner is the bench's alone now: "MAX 480 MEN" is a measurement
   whose whole point is the sentence. A war says what happened with the
   camera (the director goes wide over a rout, lands on the last man) and
   the sound (a falling horn when a line gives way), not with captions. */
let bannerT = 0;
function banner(big, small) {
  el("banner").innerHTML = big + (small ? "<small>" + small + "</small>" : "");
  el("banner").classList.add("on");
  bannerT = 3.4;
}
/* ============================================================ THE CALL
   A WAR YOU WATCH NEEDS SOMETHING RIDING ON IT. The question machine was
   always "who wins?" — so the page asks it. You call a side before START
   (the war room) or for the next round (the result card); the result card
   answers it, and a streak remembers how good your eye is across rounds.
   LOSER +50% is the other half of the loop: it hands the beaten side half
   again and runs it back, which is how "how many men DOES it take to beat a
   gorilla" gets answered in five rounds instead of argued about. */
function sideName(team) {
  const u = team === "red" ? SET.redU : SET.blueU;
  if (u === "men" || typeof kindLabel !== "function") return TEAMS[team].name;
  return kindLabel(u);
}
const STREAK_KEY = "cbz-npcwar-streak";
function readStreak() {
  try { return Object.assign({ streak: 0, best: 0, calls: 0, right: 0 }, JSON.parse(localStorage.getItem(STREAK_KEY) || "{}")); }
  catch (e) { return { streak: 0, best: 0, calls: 0, right: 0 }; }
}
let nextCall = null, callScored = false;
function warURL(o) {
  const p = new URLSearchParams();
  p.set("map", SET.map);
  p.set("red", o.red != null ? o.red : SET.redN); p.set("blue", o.blue != null ? o.blue : SET.blueN);
  p.set("ru", SET.redU); p.set("bu", SET.blueU); p.set("rw", SET.redW); p.set("bw", SET.blueW);
  p.set("rt", SET.redT); p.set("bt", SET.blueT); p.set("rs", SET.redS); p.set("bs", SET.blueS);
  if (o.call) p.set("call", o.call);
  p.set("auto", "1");
  return location.pathname + "?" + p.toString();
}
/* MOMENTUM, SHOWN. The man layer calls this when the war turns: an army
   breaks and runs, or is down to its last man. The director answers with
   the lens and the horn; nothing is captioned. Rallies and kill streaks
   are visible in the fight itself and need no hook here. */
function warEvent(kind, d) {
  d = d || {};
  const team = d.team;
  if (!team || !TEAMS[team]) return;
  if (kind === "rout") {
    // the director goes wide over the run: the broken line and the pursuit
    // behind it is the picture of the moment the war was decided
    const c = teamCOM[team];
    if (c && cam.mode === "auto" && MAP) {
      cam.shot = "crane"; cam.followM = null;
      cam.wFocus.set(c.x, MAP.groundAt(c.x, c.z), c.z);
      cam.wDist = 58; cam.wPitch = 0.44;
      cam.wYaw = fightAxis() + Math.PI * 0.75;
      cam.craneSpin = 0.02; cam.cutAt = simT + 7;
    }
    // a falling horn: the sound of a line giving way
    if (CBZ.micro.sfx && CBZ.micro.sfx.tone) { try { CBZ.micro.sfx.tone(196, 0.9, { type: "sawtooth", slideTo: 110, gain: 0.08 }); } catch (e) {} }
  } else if (kind === "lastman") {
    let m = null;
    for (let i = 0; i < men.length; i++) if (men[i].id === d.id) { m = men[i]; break; }
    // the lens goes to him: this is the shot the whole war was building to
    if (m && !m.dead && cam.mode === "auto") {
      cam.shot = "point"; cam.followM = m; cam.holdT = 0; cam.cutAt = simT + 12;
    }
  }
}
function endWar(won) {
  if (FRONT) { frontEnd(won); return; }
  over = true;
  winner = won;
  const h = el("endT");
  h.textContent = won ? sideName(won) + " WIN" : "NOBODY LEFT";
  h.className = won || "";
  // the call, scored once; the streak is only worth saying once it is one
  const ec = el("endCall");
  ec.className = ""; ec.textContent = "";
  if (SET.call && won && !callScored) {
    callScored = true;
    const st = readStreak();
    const right = SET.call === won;
    st.calls++; if (right) { st.right++; st.streak++; st.best = Math.max(st.best, st.streak); } else st.streak = 0;
    try { localStorage.setItem(STREAK_KEY, JSON.stringify(st)); } catch (e) {}
    ec.className = right ? "right" : "wrong";
    ec.textContent = right ? (st.streak >= 2 ? st.streak + " IN A ROW" : "YOU CALLED IT") : "WRONG CALL";
  }
  nextCall = SET.call || null;
  el("end").querySelectorAll(".calls button").forEach(function (b) { b.classList.toggle("on", b.dataset.call === nextCall); });
  const loserTeam = won === "red" ? "blue" : won === "blue" ? "red" : null;
  el("endLoser").style.display = loserTeam ? "" : "none";
  if (loserTeam) {
    const n = loserTeam === "red" ? SET.redN : SET.blueN;
    el("endLoser").textContent = sideName(loserTeam) + " " + n + " TO " + Math.max(n + 1, Math.ceil(n * 1.5));
  }
  el("end").style.display = "grid";
  el("ctl").classList.add("idle");
}
CBZ.npcwar.onBoot(function () {
  el("end").querySelectorAll(".calls button").forEach(function (b) {
    b.addEventListener("click", function () {
      nextCall = nextCall === b.dataset.call ? null : b.dataset.call;
      el("end").querySelectorAll(".calls button").forEach(function (x) { x.classList.toggle("on", x.dataset.call === nextCall); });
    });
  });
  // AGAIN used to be location.reload(), which on a war started from the menu
  // (no ?auto) dropped you straight back on the setup card. A rematch is the
  // same war, now, with your next call riding on it.
  el("endAgain").addEventListener("click", function () {
    if (FRONT) { frontPost("end"); return; }
    location.href = warURL({ call: nextCall });
  });
  el("endLoser").addEventListener("click", function () {
    const o = { call: nextCall };
    if (winner === "red") o.blue = Math.max(SET.blueN + 1, Math.ceil(SET.blueN * 1.5));
    else if (winner === "blue") o.red = Math.max(SET.redN + 1, Math.ceil(SET.redN * 1.5));
    location.href = warURL(o);
  });
  el("endMenu").addEventListener("click", function () {
    location.href = location.pathname;
  });
  el("endWatch").addEventListener("click", function () { el("end").style.display = "none"; });
});
