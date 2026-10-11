"use strict";
/* src/battle/load.js — NPC War: LOAD: the packs and the armoury this page pulls in.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ LOAD
   Base packs first; the armoury after, in dependency order. Every file in
   the second list is engine source loaded verbatim — the page adds nothing
   to any of them. */
/* bestiary + beasts ride in the base load on purpose: the menu lists every
   species BY READING the bestiary (a hardcoded copy of 54 names is the exact
   stat-fiction this repo bans), and the three beast files are pure drivers —
   no engine, no spawner, nothing scheduled. Measured cost is a handful of
   small data files on a load that already fetches thirty. */
/* `ragdoll` rides in the base load with `people`, and it is not a tax: MEN are
   this page's primary unit and every one of them used to fall like a plank.
   city/ragdoll.js is the original of the method the animals' solver copied —
   13 points, sticks, joint limits, a ground clamp — writing back onto the same
   rig meshes, so the wounds and the dropped rifle ride along for free. */
/* `verbs` rides in the base load for the FISTS: systems/verbs_strike.js lands
   a blow on the real rig, and (once the melee wave is in) systems/melee.js is
   the one fighter brain combat_iq hands every fist fight to, the possessed
   man's included (CBZ.melee.drive in player.js). Preloaded so the first man
   who squares up does not fight a second on the old state machine while it
   arrives. */
const NEED = ["caps", "speech", "people", "ragdoll", "fx", "damage", "sound", "batch", "bestiary", "beasts", "meshcol", "verbs"];
// ?marine=0 refuses the marine pack even on OPEN WATER (the revert). Its
// absence is what shipped: models with no hunt, no fin, no blood, no prey.
const MARINE_Q = Q.get("marine");
// Is this roster entry a sea animal? Asked of the LIVE bestiary rather than a
// name list, so a species added tomorrow pulls the pack without an edit here.
function isWaterSpecies(u) {
  if (!u || u === "men") return false;
  const sp = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[u];
  return !!(sp && (sp.aquatic || sp.biome === "water"));
}
const ARMOURY = [
  "weapons/weapon-data.js",
  "weapons/weapon-scale.js",   // real-dimension display sizing (math, not magic scalars)
  "systems/fphands.js",        // the one first-person hand (the gun kit closes it on every grip)
  "weapons/optics.js",         // the one real scope factory (the sniper's glass)
  "weapons/appearances/sidearm.js", "weapons/appearances/shotgun.js",
  "weapons/appearances/carbine.js", "weapons/appearances/smg.js",
  "weapons/appearances/revolver.js", "weapons/appearances/deagle.js",
  "weapons/appearances/ak47.js", "weapons/appearances/uzi.js",
  "weapons/appearances/sniper.js", "weapons/appearances/lmg.js",
  "weapons/appearances/bazooka.js", "weapons/appearances/taser.js",
  "weapons/appearances/glauncher.js",
  "systems/actorweapons.js",   // guns in hands + muzzle points + drop physics
  "systems/gunfx.js",          // tracers, flashes, impacts, holes, suppression
  "systems/combat_iq.js",      // HOW WELL A PERSON FIGHTS — the whole point
  "systems/brain.js",          // CBZ.brain: the ONE morale (brain.morale) every army shares
  "systems/wounds.js",         // bodies remember hits (optional, self-capping)
  "world/hull_loft.js",        // the game's own lofted boat hulls (OPEN WATER's fleet)
  "city/flags.js",             // the one flag system: an army fights under its nation's flag
  "world/textures_surface.js", // groundTurf: the one grass shader (OPEN FIELDS' pasture)
];
/* THE LOAD USED TO BE THIRTY-ONE ROUND TRIPS IN A ROW.

   Both halves waited on one file at a time: studio.need() awaits each pack
   file before appending the next (it must — the load ORDER is a contract),
   and the armoury chain above it did the same by hand, one Promise per gun.
   Serial execution is right; serial DOWNLOADING was never asked for and cost
   the whole boot on a hop-per-file host.

   So: everything this page could want is FETCHED at once, and executed in
   exactly the order it always was.
     • studio.warm()/prefetch() emit <link rel=preload as=script>, which fills
       the HTTP cache without running a line — need()'s serial chain then
       finds every file already in hand.
     • the armoury goes in as one batch of tags with async=false, which is the
       spec's "execute in order as soon as possible" list. That is safe HERE
       and not in the studio, because none of these files calls addLandmass,
       so nothing depends on exactly one script being in flight.
     • and the person watching gets a real bar instead of three words. */
const PLAN = CBZ.studio.plan(NEED);
let TOTAL_FILES = PLAN.files.length + ARMOURY.length;
let filesIn = 0;
function bar(label) {
  const b = el("bootbar");
  if (b) b.style.width = Math.round(filesIn / Math.max(1, TOTAL_FILES) * 100) + "%";
  if (label) bootst(label + "  " + filesIn + "/" + TOTAL_FILES);
}
CBZ.studio.onProgress(function (p) {
  filesIn++;
  bar("LOADING " + p.file.replace(/^.*\//, "").replace(/\.js$/, "").toUpperCase());
});
function loadArmoury() {
  return new Promise(function (resolve) {
    let left = ARMOURY.length;
    if (!left) return resolve();
    ARMOURY.forEach(function (rel) {
      const s = document.createElement("script");
      s.src = CBZ.studio.root + rel;
      s.async = false;                        // ordered execution, parallel download
      const tick = function () {
        filesIn++; bar("ARMOURY");
        if (--left === 0) resolve();
      };
      s.onload = tick;
      s.onerror = function () { console.warn("[war] optional file failed:", rel); tick(); };
      document.head.appendChild(s);
    });
  });
}

/* the armoury the way it used to arrive — one file, one round trip, wait,
   repeat. Kept only so ?warm=0 can put a number on what the change bought. */
function loadArmourySerial() {
  let chain = Promise.resolve();
  ARMOURY.forEach(function (rel) {
    chain = chain.then(function () {
      return new Promise(function (resolve) {
        const s = document.createElement("script");
        s.src = CBZ.studio.root + rel;
        s.async = false;
        s.onload = function () { filesIn++; bar("ARMOURY"); resolve(); };
        s.onerror = function () { filesIn++; resolve(); };
        document.head.appendChild(s);
      });
    });
  });
  return chain;
}

/* THE UNITS A ROSTER NAMES load at START, not with the page
   (units/unitkit.js). A men-only war asks for nothing and begins on the same
   tick it always did; a tiger, a tank or a dog brings its own file (and the
   engine files that file `needs`) first. */
function unitsFor() {
  const R = CBZ.battleRoster, K = CBZ.unitKit;
  if (!R || !K) return [];
  return R.ids(SET.redU).concat(R.ids(SET.blueU)).filter(function (id, i, a) {
    return id !== "men" && a.indexOf(id) === i && !!K.fileOf(id) && !K.has(id);
  });
}
function withUnits(fn) {
  const ids = unitsFor();
  if (!ids.length) { fn(); return; }
  bootst("BRINGING UP THE " + (ids.length === 1 ? "UNIT" : "UNITS"));
  CBZ.unitKit.need(ids).then(fn);
}
