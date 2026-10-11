"use strict";
/* src/battle/spawn.js — NPC War: SPAWN.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ SPAWN */
function queueMen(perSide) {
  const r0 = spawnCount.red, b0 = spawnCount.blue;
  for (let i = 0; i < perSide; i++) {
    spawnQueue.push(["red", r0 + i], ["blue", b0 + i]);
  }
  spawnCount.red += perSide; spawnCount.blue += perSide;
  spawnTotal = spawnCount.red + spawnCount.blue;
}
const spawnCount = { red: 0, blue: 0 };
function drainSpawns() {
  let n = 0;
  while (spawnQueue.length && n < 10) {
    const s = spawnQueue.shift();
    const kind = kindAt(s[0] === "red" ? SET.redU : SET.blueU, s[1]);
    const m = kind === "men" ? makeMan(s[0], s[1]) : makeBeast(s[0], s[1], kind);
    if (m) men.push(m);
    n++;
  }
}
