"use strict";
/* src/battle/front.js — NPC War: THE FRONT: CHROME.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ THE FRONT: CHROME
   The General's two orders sit in the same wordless row as the clock: the
   flag (lit = HOLD, dark = ADVANCE) and the plane (his sorties left). */
function paintFrontCtl() {
  const h = el("cHold"), a = el("cAir");
  if (!h || !a) return;
  // a rifle only where there are men to carry one
  el("cRifle").classList.toggle("hide", !youTeam() || !!bench);
  h.classList.toggle("hide", !FRONT);
  h.classList.toggle("on", ORDER.red === "hold");
  h.style.setProperty("--cc", "#" + TEAMS.red.color.toString(16).padStart(6, "0"));
  const showAir = !!(FRONT && (AIRSTRIKE.left > 0 || AIRSTRIKE.used > 0));
  a.classList.toggle("hide", !showAir);
  el("cAirN").textContent = AIRSTRIKE.left > 0 ? String(AIRSTRIKE.left) : "";
  a.style.opacity = AIRSTRIKE.left > 0 ? "" : ".35";
}
/* THE RESULT, AT THE FRONT: who held the line, and the dead on both sides,
   under the two flags. One way out: back to the city, which takes the
   numbers (city/frontline.js applies them to the war). */
function frontEnd(won) {
  over = true;
  winner = won;
  if (YOU.m) leaveYou(false);
  const h = el("endT");
  const verb = won ? (FRONT.hold === won ? " HOLD" : " BREAK THROUGH") : "";
  h.textContent = won ? TEAMS[won].name + verb : "NOBODY HOLDS";
  h.className = "";
  if (won) h.style.color = "#" + TEAMS[won].color.toString(16).padStart(6, "0");
  const ec = el("endCall");
  ec.className = "";
  ec.innerHTML = "<div class=\"tally\"><span>" + flagImg("red") + DEADN.red + " DEAD</span><span>" + flagImg("blue") + DEADN.blue + " DEAD</span></div>" +
    (YOU.down ? "<div style=\"opacity:.7\">YOU WERE HIT</div>" : "");
  const acts = el("end").querySelector(".acts");
  [".nl", ".calls"].forEach(function (q) { const n = acts && acts.querySelector(q); if (n) n.style.display = "none"; });
  el("endLoser").style.display = "none";
  const row = el("endMenu").parentNode;
  if (row) row.style.display = "none";
  el("endAgain").textContent = "RETURN";
  el("end").style.display = "grid";
  el("ctl").classList.add("idle");
}
let posted = false;
function frontPost(kind) {
  if (posted) return;
  posted = true;
  // the men still running when it was decided got away; the rest stand
  const fled = { red: ARMY.red.fled, blue: ARMY.blue.fled }, alive = { red: 0, blue: 0 };
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.dead || m.fled) continue;
    if (kind === "end" && m.routed) fled[m.team]++; else alive[m.team]++;
  }
  const msg = { type: "cbz-front", kind: kind, warId: FRONT.warId, winner: kind === "end" ? winner : null,
    dead: { red: DEADN.red, blue: DEADN.blue }, fled: fled, alive: alive,
    strikesUsed: AIRSTRIKE.used, youDown: !!YOU.down, secs: Math.round(simT) };
  if (YOU.m) leaveYou(false);
  try {
    if (window.parent && window.parent !== window) { window.parent.postMessage(msg, location.origin || "*"); return; }
  } catch (e) {}
  // opened on its own (no city behind it): the war room's way home
  location.href = "../index.html";
}
