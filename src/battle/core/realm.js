/* ============================================================
   battle/core/realm.js — ONE SIM, ANY PAGE.

   NPC War's sim (src/battle/*.js: men, animals, vehicles, fire, squads, the
   tiers) is a set of classic scripts that share ONE scope on
   games/battle.html. A second host cannot load them as page scripts: their
   top-level names (men, HOST, SET, frame ...) would land in that page's
   global scope among its own. So a second host compiles the SAME files into
   one private function scope, a REALM: its own page layer first (the names
   the sim asks its page for), then the sim files in battle.html's order, then
   the host's glue, which returns the host's handle on the sim.

   One sim, two hosts: battle.html runs the files as scripts, Gang City
   (city/army.js) compiles them here. Nothing is copied or forked.

   THE PAGE LAYER: every name a sim file reads from a NON-sim battle file
   (settings.js, menu.js, player.js, camera/*, probe.js ...) is listed in
   PAGE_NAMES. A host's page file must declare each of them;
   tools/npcwar-check.mjs holds both the list and Gang City's page file to it.

   PUBLIC  CBZ.battleRealm = {
             SIM,                    the sim files (relative to src/), in order
             PAGE_NAMES,             what a host's page layer declares
             compile(files, opts) -> { fn, where(line) }
             run(compiled, page)  -> whatever the host glue exported
           }
     files  [{ name, code }]: the host's page file, the SIM files, its glue
     the glue ends with `const REALM_EXPORT = { ... }` (no top-level return,
     so every file still passes node --check on its own)
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});

  // games/battle.html's order, the FULL tier and the tiers (no war room, no
  // arenas, no camera, no HUD, no probe: those are NPC War's page)
  const SIM = [
    "battle/teams.js", "battle/arms.js", "battle/state.js",
    "battle/men.js", "battle/beasts.js", "battle/damage.js", "battle/ai/morale.js", "battle/death.js",
    "battle/physics.js", "battle/vehicles.js", "battle/ai/orders.js", "battle/fire.js", "battle/air.js",
    "battle/ai/think.js", "battle/ai/squad.js", "battle/step.js", "battle/melee.js",
    "battle/spawn.js", "battle/mass.js", "battle/massdraw.js", "battle/tick.js",
  ];
  /* the names the sim reads from NPC War's page files: a host's page layer
     declares every one (its own meaning for each: Gang City has no war room,
     no kill cam, no possession). Kept honest by tools/npcwar-check.mjs. */
  const PAGE_NAMES = [
    // settings.js
    "el", "STUDIO", "Q", "SET", "PROBE", "BATTLE_SEED", "CORPSE_MAX",
    "DEATH_OLD", "FIRE_OLD", "SEP_OLD", "SHARE_OLD", "STEER_OLD", "SWIM_OLD",
    // arenas (the ground's own answers)
    "MAPS", "SEA", "cruiseDepth", "stepDepth",
    // the kill cam, study desk, possession, director, probe, settings panel, menu
    "killCam", "STUDY", "YOU", "stepYou", "youDown", "youInput", "youRetarget",
    "warEvent", "QUAL", "SETTINGS", "HAS_BEASTS",
  ];

  // the kernel the sim files register their boot blocks on (battle/npcwar.js's
  // shape): a realm gets its own, run once the files are in
  function kernel() {
    const boots = [];
    let ran = false;
    return {
      onBoot: function (fn) { if (ran) fn(); else boots.push(fn); },
      runBoot: function () { if (ran) return; ran = true; for (let i = 0; i < boots.length; i++) boots[i](); },
    };
  }

  function compile(files, opts) {
    opts = opts || {};
    const parts = ['"use strict";'];
    const map = [];               // [startLine, name, lines]
    let line = 2;                 // the Function wrapper adds one line before the body
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const code = String(f.code).replace(/^\s*["']use strict["'];?/, "");
      const n = code.split("\n").length;
      map.push([line + 1, f.name, n]);
      parts.push("/* ---- " + f.name + " ---- */\n" + code + "\n;");
      line += n + 2;
    }
    parts.push('return (typeof REALM_EXPORT !== "undefined") ? REALM_EXPORT : null;');
    parts.push("//# sourceURL=" + (opts.name || "battle-realm") + ".js");
    const body = parts.join("\n");
    let fn = null, err = null;
    try { fn = new Function("REALM_PAGE", body); }   // eslint-disable-line no-new-func
    catch (e) { err = e; }
    function where(ln) {
      for (let i = map.length - 1; i >= 0; i--) if (ln >= map[i][0]) return map[i][1] + ":" + (ln - map[i][0] + 1);
      return "?:" + ln;
    }
    return { fn: fn, err: err, where: where, files: files.map(function (f) { return f.name; }) };
  }
  // run a compiled realm: a fresh kernel for its boot blocks, the page object
  // the host's page layer reads (REALM_PAGE), then every boot block in order
  function run(compiled, page) {
    if (!compiled || !compiled.fn) throw compiled && compiled.err ? compiled.err : new Error("realm did not compile");
    const prev = CBZ.npcwar;
    const K = kernel();
    CBZ.npcwar = K;
    let out;
    try {
      out = compiled.fn(page || {});
      K.runBoot();
    } finally {
      // battle.html's own kernel (if this page has one) is not this realm's
      if (prev) CBZ.npcwar = prev;
    }
    return out;
  }

  CBZ.battleRealm = { SIM: SIM, PAGE_NAMES: PAGE_NAMES, compile: compile, run: run, kernel: kernel };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.battleRealm;
})();
