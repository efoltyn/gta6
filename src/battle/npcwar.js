"use strict";
/* src/battle/npcwar.js — NPC War's kernel. Loaded first by games/battle.html.

   games/battle.html used to be one 8,400-line inline script. It is now the
   files under src/battle/, loaded in the order battle.html lists them, all
   sharing ONE script scope (classic scripts share the global lexical scope:
   a top-level `let`/`const`/`function` in one battle file is visible in the
   next). That is the old closure, split along its seams, nothing renamed.

   Two kinds of top-level code:
     • declarations that need nothing loaded (functions, literal tables) sit
       at the top of their file and are live as soon as the file runs;
     • anything that needs THREE, the studio's packs or the war room's DOM
       is wrapped in CBZ.npcwar.onBoot(fn). main.js loads the armoury and
       then runs every onBoot fn ONCE, in file order — exactly the order the
       old inline .then() body ran in.

   The rules for the ~50 agents that edit these files are in
   docs/npcwar/ARCHITECTURE.md. tools/npcwar-check.mjs holds the shared scope
   honest (no name declared twice, no file that fails to parse). */
(function () {
  const W = window.CBZ = window.CBZ || {};
  const boots = [];
  let ran = false;
  W.npcwar = {
    /** run fn once after the armoury loads, in file (registration) order */
    onBoot(fn) {
      if (ran) { fn(); return; }
      boots.push(fn);
    },
    runBoot() {
      if (ran) return;
      ran = true;
      for (let i = 0; i < boots.length; i++) boots[i]();
    },
  };
})();
