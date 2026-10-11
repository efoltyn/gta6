"use strict";
/* src/battle/settings.js — NPC War: SETTINGS: URL params + saved setup (SET), THE FRONT spec, revert switches, THE DEAD tunables.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

const el = function (id) { return document.getElementById(id); };
const bootst = function (t) { const n = el("bootst"); if (n) n.textContent = t; };

/* ============================================================ SETTINGS
   URL params override localStorage so a benchmark or a shared link can
   reproduce a battle exactly. */
const Q = new URLSearchParams(location.search);
const saved = (function () { try { return JSON.parse(localStorage.getItem("cbz-npcwar") || "{}"); } catch (e) { return {}; } })();
const SET = {
  map:   Q.get("map")  || saved.map  || "dunes",
  redN:  parseInt(Q.get("red")  || saved.redN  || 30, 10) || 30,
  blueN: parseInt(Q.get("blue") || saved.blueN || 30, 10) || 30,
  redU:  Q.get("ru") || saved.redU || "men",     // WHO fights: "men" or a bestiary species id
  blueU: Q.get("bu") || saved.blueU || "men",
  redW:  Q.get("rw") || saved.redW || "ak47",
  blueW: Q.get("bw") || saved.blueW || "ak47",
  redT:  Q.get("rt") || saved.redT || "elite",
  blueT: Q.get("bt") || saved.blueT || "elite",
  redS:  Q.get("rs") || saved.redS || "none",
  blueS: Q.get("bs") || saved.blueS || "none",
  bench: Q.get("bench") === "1",
  auto:  Q.get("auto") === "1",
  /* THE CALL: who you said would win, "red" | "blue" | null. Set on the war
     room, persisted in the blob by readMenu(); the end screen scores it
     against "cbz-npcwar-streak" ({streak, best, calls, right}). */
  call:  Q.get("call") || null,
};
if (SET.call !== "red" && SET.call !== "blue") SET.call = null;
/* ============================================================ THE FRONT
   city/frontline.js opens this page over Gang City (same tab, an iframe) with
   ?front=<the battle as base64 JSON>: two nations, their committed men, their
   training and rifles, their colours and flags, the ground under the front,
   who holds the line, and the air each side can fly. The war room is skipped;
   the result goes back to the city on postMessage (frontPost below). */
const FRONT = (function () {
  const raw = Q.get("front");
  if (!raw) return null;
  try {
    const b = raw.replace(/-/g, "+").replace(/_/g, "/");
    const f = JSON.parse(decodeURIComponent(escape(atob(b + "===".slice((b.length + 3) % 4)))));
    return f && f.red && f.blue ? f : null;
  } catch (e) { console.warn("[war] bad front spec", e); return null; }
})();
if (FRONT) {
  SET.map = FRONT.ground || "dunes";
  SET.redN = Math.max(1, FRONT.red.n | 0); SET.blueN = Math.max(1, FRONT.blue.n | 0);
  SET.redU = SET.blueU = "men";
  SET.redW = FRONT.red.guns || "ak47"; SET.blueW = FRONT.blue.guns || "ak47";
  SET.redT = FRONT.red.tier || "pro"; SET.blueT = FRONT.blue.tier || "pro";
  SET.redS = FRONT.red.air || "none"; SET.blueS = FRONT.blue.air || "none";
  SET.auto = true; SET.bench = false; SET.call = null;
  document.body.classList.add("front");
}
/* The quality counters cost a segment test and a lane scan on every trigger
   pull, which is worth paying when a tool is watching and worth nothing when
   a person is. On for ?auto=1 and ?bench=1 (both are tools), on for ?probe=1,
   off otherwise. */
const PROBE = Q.get("probe") === "1" || (Q.get("probe") !== "0" && !FRONT && (SET.auto || SET.bench));
const SEP_OLD = Q.get("sep") === "old";      // the revert switch — see separateOld()
const FIRE_OLD = Q.get("fire") === "old";    // ditto, for fire discipline
const STEER_OLD = Q.get("steer") === "old";  // ditto, for wall-aware goal projection
const SHARE_OLD = Q.get("share") === "old";  // ditto, for squad target sharing
const SUPPORTS = [
  { id: "none", label: "NO AIR" },
  { id: "bomber", label: "ONE BOMBER" },
  { id: "bomber2", label: "TWO BOMBERS" },
  { id: "nuke", label: "NUKE RUN" },
];
if (SET.redN < 1) SET.redN = 1;
if (SET.blueN < 1) SET.blueN = 1;

/* ============================================================ THE DEAD
   THE CORPSE SOLVER IS SIZED FOR A SPECTATOR, NOT FOR A PLAYER.

   systems/quadruped_ragdoll.js's three budget numbers were chosen for the
   city, where the camera is a person standing in the fight: it can only ever
   be near a handful of deaths at once, so eight solving bodies and a 78 m
   range gate are generous. This page is the opposite shape — you FLY over an
   army, whole ranks of animals go down in the same second, and every body the
   solver refuses falls back to the canned tumble. Declared before need() so
   the flags are already in place when the pack file runs, and every one of
   them is a `?cfg_*` away from the shipped default (microboot applies those).

   NOTE these are ceilings, not allocations: the pool grows only as bodies
   actually arrive, and MAX_ACTIVE still freezes the OLDEST settling corpse
   rather than refusing a fresh one. */
CBZ.CONFIG = CBZ.CONFIG || {};
if (CBZ.CONFIG.QUAD_RAGDOLL_RANGE == null) CBZ.CONFIG.QUAD_RAGDOLL_RANGE = 190;
if (CBZ.CONFIG.QUAD_RAGDOLL_ACTIVE == null) CBZ.CONFIG.QUAD_RAGDOLL_ACTIVE = 26;
if (CBZ.CONFIG.QUAD_RAGDOLL_POOL == null) CBZ.CONFIG.QUAD_RAGDOLL_POOL = 96;
// ...and the sim clock owns them. A battle at quarter speed with corpses
// folding at wall speed is the page arguing with itself; SPACE must freeze
// the dead as dead as it freezes the living. See the step call in frame().
CBZ.quadRagdollDriven = true;
/* ...and the same three decisions for the MEN, whose solver (city/ragdoll.js)
   has the identical shape. RAGDOLL_ANY_MODE is the one that matters: that file
   refused every mode but "city" — never because 13 points and a ground clamp
   care what mode is running, only because the city was the one thing with peds
   the day it shipped. This page has armies of them. */
if (CBZ.CONFIG.RAGDOLL_ANY_MODE == null) CBZ.CONFIG.RAGDOLL_ANY_MODE = true;
if (CBZ.CONFIG.RAGDOLL_RANGE == null) CBZ.CONFIG.RAGDOLL_RANGE = 190;
if (CBZ.CONFIG.RAGDOLL_ACTIVE == null) CBZ.CONFIG.RAGDOLL_ACTIVE = 30;
if (CBZ.CONFIG.RAGDOLL_POOL == null) CBZ.CONFIG.RAGDOLL_POOL = 120;
CBZ.ragdollDriven = true;
/* HOW LONG A BODY STAYS. `corpses` used to be a hard FIFO of 260 that dropped
   the oldest outright — a carcass in plain sight popped out of existence the
   moment the 261st man fell, which on a 300-a-side battle is constantly and
   is exactly the "and then they disappear" in the report. ?corpses=N sets the
   budget; the eviction itself is now a sink-and-fade nobody can catch. */
const CORPSE_MAX = Math.max(4, parseInt(Q.get("corpses") || "420", 10) || 420);

/* ?death=old — THE REVERT SWITCH FOR THE WHOLE BEAST-DEATH WAVE, in the same
   shape as sep/fire/steer/share above, and for the same reason: a fix nobody
   can turn off has not been measured. It restores, verbatim and all at once:
     • the canned `rotation.z` topple — the nose-to-sky pose in the report;
     • the hard corpse FIFO that deleted a body where it lay;
     • bites that land at centre-to-centre range and draw no blood.
   One switch, because the three shipped as one wave and a before/after has to
   be able to photograph the whole of it against itself. */
const DEATH_OLD = Q.get("death") === "old";
const BLOOD_Q = Q.get("blood");        // "1" force it on, "0" force it off
if (DEATH_OLD) {
  CBZ.CONFIG.WILDLIFE_RAGDOLL = false;
  CBZ.CONFIG.CREATURE_BITE_BLOOD = false;
  CBZ.CONFIG.CREATURE_JAW_CONTACT = false;
  CBZ.CONFIG.RAGDOLL_ANY_MODE = false;      // ...and the men fall like planks again
}

/* ?mass=old — THE SAME SHAPE OF SWITCH FOR THE OTHER WAVE THIS PAGE CARRIES.
   Before it, every melee number in the game was read off the ATTACKER and
   handed to the target untouched, so a civilian's fist took the same bite out
   of a 190 kg silverback as out of another man — which is the whole reason a
   hundred unarmed men could arithmetic a gorilla to death without it mattering
   what a gorilla is. systems/bodymass.js makes the pair a ratio; man on man is
   1.0 by construction, so a battle of riflemen is byte-identical either way and
   this switch photographs exactly the mismatch and nothing else. */
const MASS_OLD = Q.get("mass") === "old";
if (MASS_OLD) CBZ.CONFIG.BODY_MASS = false;

/* ?swim=old — THE SAME SHAPE OF SWITCH FOR THE WATER WAVE, and for the same
   reason: a fix nobody can turn off has not been measured. It restores, all at
   once, the ocean this page WOULD have had if the sea had only ever been a
   height:
     • NO SWIM RIG — every aquatic body a rigid mesh sliding through the water
       with its jaw welded shut, which is literally what the `beasts` pack
       shipped before the rig moved out of the hunting engine;
     • NO DEPTH — every body pinned to the surface plane, so a shark and a bait
       ball fight in two dimensions and "dive" is a word;
     • NO UNDERWATER CAMERA — the lens stops at the waterline and the fog above
       it never changes, so a shot from below does not exist.
   One switch, because the three shipped as one wave and a before/after has to
   be able to photograph the whole of it against itself. */
const SWIM_OLD = Q.get("swim") === "old";
